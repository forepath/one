#!/bin/bash
set -euo pipefail

APP_UID="${APP_UID:-10001}"
APP_GID="${APP_GID:-10001}"

chown -R "${APP_UID}:${APP_GID}" /app 2>/dev/null || true

hostname="${OPENCODE_SERVER_HOSTNAME:-0.0.0.0}"
opencode_port="${OPENCODE_SERVER_PORT:-4096}"
vnc_display="${VNC_DISPLAY:-:1}"
vnc_port="${VNC_PORT:-5901}"
websockify_port="${VNC_WEBSOCKIFY_PORT:-6080}"
websockify_upstream_port="${VNC_WEBSOCKIFY_UPSTREAM_PORT:-6081}"
geometry="${VNC_GEOMETRY:-1920x1080}"
depth="${VNC_DEPTH:-24}"

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
chown -R "${APP_UID}:${APP_GID}" /tmp/runtime-agenstra /home/agenstra
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
runuser -u agenstra -g agenstra -- env HOME=/home/agenstra USER=agenstra DISPLAY="${vnc_display}" \
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
  if bash -c "echo >/dev/tcp/127.0.0.1/${vnc_port}" 2>/dev/null; then
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

runuser -u agenstra -g agenstra -- env \
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
runuser -u agenstra -g agenstra -- websockify \
  "127.0.0.1:${websockify_upstream_port}" \
  "127.0.0.1:${vnc_port}" &
WEBSOCKIFY_PID=$!

runuser -u agenstra -g agenstra -- env \
  OPENCODE_SERVER_USERNAME="${OPENCODE_SERVER_USERNAME:-opencode}" \
  OPENCODE_SERVER_PASSWORD="${OPENCODE_SERVER_PASSWORD:?OPENCODE_SERVER_PASSWORD is required}" \
  VNC_WEBSOCKIFY_PORT="${websockify_port}" \
  VNC_WEBSOCKIFY_UPSTREAM_PORT="${websockify_upstream_port}" \
  node /usr/local/bin/vnc-auth-proxy.js &
AUTH_PROXY_PID=$!

runuser -u agenstra -g agenstra -- opencode serve --hostname "${hostname}" --port "${opencode_port}" &
OPENCODE_PID=$!

wait "${OPENCODE_PID}"
exit_code=$?
cleanup
trap - EXIT INT TERM
exit "${exit_code}"
