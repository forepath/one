#!/bin/bash
set -euo pipefail

# Privileged initialisation must not resolve binaries through agent-writable directories (the image PATH
# starts with ~/.opencode/bin and the nvm Node bin, both owned by agenstra), so pin a root-owned PATH and
# hand the image PATH only to processes started after the privilege drop (see run_as_agent).
AGENT_PATH="${PATH}"
export PATH=/usr/sbin:/usr/bin:/sbin:/bin

# Managed agent environment (agent-manager writes NUL-separated KEY=VALUE entries to the mounted volume;
# see image label io.agenstra.environment-mount). Entries are never evaluated by the shell and never
# exported into this root shell: `env` applies them only after `runuser` dropped privileges. The
# entrypoint's own settings below are read from the file into unexported shell variables.
AGENSTRA_ENVIRONMENT_FILE=/etc/agenstra/environment/environment
agent_environment=()

if [[ -f "${AGENSTRA_ENVIRONMENT_FILE}" && ! -L "${AGENSTRA_ENVIRONMENT_FILE}" ]]; then
  while IFS= read -r -d '' entry || [[ -n "${entry}" ]]; do
    name="${entry%%=*}"

    # Conventional names only: rejects option-like entries and exported Bash functions (BASH_FUNC_*%%).
    if [[ "${entry}" != *=* || ! "${name}" =~ ^[A-Za-z_][A-Za-z0-9_.-]*$ ]]; then
      continue
    fi

    agent_environment+=("${entry}")

    case "${name}" in
      APP_UID | APP_GID | OPENCODE_SERVER_HOSTNAME | OPENCODE_SERVER_PORT | OPENCODE_SERVER_USERNAME | \
        OPENCODE_SERVER_PASSWORD | VNC_DISPLAY | VNC_PORT | VNC_WEBSOCKIFY_PORT | VNC_WEBSOCKIFY_UPSTREAM_PORT | \
        VNC_GEOMETRY | VNC_DEPTH)
        printf -v "${name}" '%s' "${entry#*=}"
        ;;
    esac
  done <"${AGENSTRA_ENVIRONMENT_FILE}"
fi

unset entry name

# Command prefix that starts a process as agenstra with the image PATH and the managed agent environment.
# Arguments appended after it go to `env`, so explicit NAME=VALUE assignments override agent entries.
# An array (not a function) keeps `$!` pointing at runuser for backgrounded processes.
run_as_agent=(/usr/sbin/runuser -u agenstra -g agenstra -- /usr/bin/env -- PATH="${AGENT_PATH}" "${agent_environment[@]}")

APP_UID="${APP_UID:-10001}"
APP_GID="${APP_GID:-10001}"

# Used by root chown/install below: accept numeric non-root IDs only.
[[ "${APP_UID}" =~ ^[1-9][0-9]*$ ]] || APP_UID=10001
[[ "${APP_GID}" =~ ^[1-9][0-9]*$ ]] || APP_GID=10001

# Only touch entries with wrong ownership: a blanket `chown -R` forces an overlayfs copy-up of every
# image-layer file (hundreds of MB under /home/agenstra), delaying `opencode serve` past health checks.
ensure_app_owner() {
  find "$@" \( ! -uid "${APP_UID}" -o ! -gid "${APP_GID}" \) -exec chown -h "${APP_UID}:${APP_GID}" {} + 2>/dev/null || true
}

ensure_app_owner /app

hostname="${OPENCODE_SERVER_HOSTNAME:-0.0.0.0}"
opencode_port="${OPENCODE_SERVER_PORT:-4096}"
vnc_display="${VNC_DISPLAY:-:1}"
vnc_port="${VNC_PORT:-5901}"
websockify_port="${VNC_WEBSOCKIFY_PORT:-6080}"
websockify_upstream_port="${VNC_WEBSOCKIFY_UPSTREAM_PORT:-6081}"
geometry="${VNC_GEOMETRY:-1920x1080}"
depth="${VNC_DEPTH:-24}"

assert_numeric_port() {
  local value="$1"

  [[ "${value}" =~ ^[0-9]+$ ]] && (( value >= 1 && value <= 65535 ))
}

assert_vnc_display() {
  [[ "$1" =~ ^:[0-9]+$ ]]
}

for port_value in "${opencode_port}" "${vnc_port}" "${websockify_port}" "${websockify_upstream_port}"; do
  if ! assert_numeric_port "${port_value}"; then
    echo "Invalid port value in managed environment" >&2
    exit 1
  fi
done

if ! assert_vnc_display "${vnc_display}"; then
  echo "Invalid VNC display value in managed environment" >&2
  exit 1
fi

export HOME=/home/agenstra
export USER=agenstra
export DISPLAY="${vnc_display}"
export XDG_RUNTIME_DIR=/tmp/runtime-agenstra
export XDG_CONFIG_HOME=/home/agenstra/.config
export XDG_CACHE_HOME=/home/agenstra/.cache
export XDG_DATA_HOME=/home/agenstra/.local/share
export XDG_CONFIG_DIRS=/etc/xdg
export XDG_DATA_DIRS=/usr/local/share:/usr/share

mkdir -p /tmp/runtime-agenstra /home/agenstra/.vnc /tmp/.X11-unix \
  /home/agenstra/.config /home/agenstra/.cache /home/agenstra/.local/share /home/agenstra/Desktop
ensure_app_owner /tmp/runtime-agenstra /home/agenstra
chmod 700 /tmp/runtime-agenstra /home/agenstra
chmod 1777 /tmp/.X11-unix

install -m 755 -o "${APP_UID}" -g "${APP_GID}" /etc/agenstra/vnc/xstartup /home/agenstra/.vnc/xstartup

cleanup() {
  local pid
  for pid in "${OPENCODE_PID:-}" "${AUTH_PROXY_PID:-}" "${WEBSOCKIFY_PID:-}" "${SESSION_PID:-}" "${VNC_PID:-}"; do
    if [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null; then
      kill "${pid}" 2>/dev/null || true
    fi
  done
}

trap cleanup EXIT INT TERM

# Drop stale display locks left after docker restart / crash; otherwise Xvnc refuses to start
# ("Server is already active") while nothing listens on the RFB port — websockify then accepts
# the browser WebSocket and immediately closes it (noVNC: Connection closed code 1005).
display_num="${vnc_display#:}"
rm -f "/tmp/.X${display_num}-lock" "/tmp/.X11-unix/X${display_num}"

# VNC only on loopback — external access must go through the authenticated proxy.
# TigerVNC daemonizes (no -fg on 1.15); track the real server PID after the RFB port is up.
"${run_as_agent[@]}" HOME=/home/agenstra USER=agenstra DISPLAY="${vnc_display}" \
  Xvnc "${vnc_display}" \
  -rfbport "${vnc_port}" \
  -geometry "${geometry}" \
  -depth "${depth}" \
  -SecurityTypes None \
  -AlwaysShared \
  -desktop "Agenstra" \
  -pn \
  -localhost yes &

vnc_ready=0
for _ in $(seq 1 60); do
  if /bin/bash -c "echo >/dev/tcp/127.0.0.1/${vnc_port}" 2>/dev/null; then
    vnc_ready=1
    break
  fi
  sleep 0.5
done

if [[ "${vnc_ready}" -ne 1 ]]; then
  echo "TigerVNC failed to listen on 127.0.0.1:${vnc_port} within timeout" >&2
  exit 1
fi

VNC_PID="$(pgrep -u agenstra -f "Xvnc ${vnc_display}" | head -n1 || true)"
if [[ -z "${VNC_PID}" ]]; then
  echo "TigerVNC bound port ${vnc_port} but no Xvnc process was found" >&2
  exit 1
fi

"${run_as_agent[@]}" \
  HOME=/home/agenstra \
  USER=agenstra \
  DISPLAY="${vnc_display}" \
  BROWSER=/usr/local/bin/chromium-agenstra \
  XDG_RUNTIME_DIR=/tmp/runtime-agenstra \
  XDG_CONFIG_HOME=/home/agenstra/.config \
  XDG_CACHE_HOME=/home/agenstra/.cache \
  XDG_DATA_HOME=/home/agenstra/.local/share \
  XDG_CONFIG_DIRS=/etc/xdg \
  XDG_DATA_DIRS=/usr/local/share:/usr/share \
  /home/agenstra/.vnc/xstartup &
SESSION_PID=$!

# Loopback websockify; public edge is the Basic-auth proxy on ${websockify_port}.
"${run_as_agent[@]}" websockify \
  "127.0.0.1:${websockify_upstream_port}" \
  "127.0.0.1:${vnc_port}" &
WEBSOCKIFY_PID=$!

"${run_as_agent[@]}" \
  OPENCODE_SERVER_USERNAME="${OPENCODE_SERVER_USERNAME:-opencode}" \
  OPENCODE_SERVER_PASSWORD="${OPENCODE_SERVER_PASSWORD:?OPENCODE_SERVER_PASSWORD is required}" \
  VNC_WEBSOCKIFY_PORT="${websockify_port}" \
  VNC_WEBSOCKIFY_UPSTREAM_PORT="${websockify_upstream_port}" \
  node /usr/local/bin/vnc-auth-proxy.js &
AUTH_PROXY_PID=$!

"${run_as_agent[@]}" opencode serve --hostname "${hostname}" --port "${opencode_port}" &
OPENCODE_PID=$!

wait "${OPENCODE_PID}"
exit_code=$?
cleanup
trap - EXIT INT TERM
exit "${exit_code}"
