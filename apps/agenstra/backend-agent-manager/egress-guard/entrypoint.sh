#!/bin/bash
# Agenstra egress guard supervisor (runs under tini as the guard container's main process).
#
# 1. Installs fail-closed netfilter rules before anything else (no policy → no egress).
# 2. Re-activates the last applied policy bundle after a restart (container FS persists it).
# 3. Supervises Squid and dnsmasq, restarting them when they exit, and streams the Squid access
#    log plus dnsmasq query log to stdout for the agent manager's egress events collector.
# 4. Reloads services on SIGHUP (sent by `agenstra-egress apply` after a new bundle is activated).
set -uo pipefail

STATE_DIR=/var/lib/agenstra-egress
ACTIVE="$STATE_DIR/active"
RUN_DIR=/run/agenstra-egress
LOG_DIR=/var/log/agenstra-egress
DEFAULT_DIR=/etc/agenstra-egress/default
CLI=/usr/local/bin/agenstra-egress
ACCESS_LOG="$LOG_DIR/access.log"
ROTATE_BYTES=$((5 * 1024 * 1024))

SQUID_PID=""
DNSMASQ_PID=""
TAIL_PID=""
RELOAD_REQUESTED=0
STOPPING=0

emit() {
  local event="$1" detail="${2:-}"

  detail="${detail//\\/\\\\}"
  detail="${detail//\"/\\\"}"
  printf 'AGENSTRA_GUARD {"event":"%s","detail":"%s","ts":%s}\n' "$event" "$detail" "$(date +%s)"
}

config_dir() {
  if [ -f "$ACTIVE/squid.conf" ] && [ -f "$ACTIVE/dnsmasq.conf" ]; then
    printf '%s' "$ACTIVE"
  else
    printf '%s' "$DEFAULT_DIR"
  fi
}

start_squid() {
  local dir
  dir="$(config_dir)"
  squid -N -f "$dir/squid.conf" >>"$LOG_DIR/squid.stdout" 2>&1 &
  SQUID_PID=$!
}

start_dnsmasq() {
  local dir
  dir="$(config_dir)"
  dnsmasq -k --conf-file="$dir/dnsmasq.conf" &
  DNSMASQ_PID=$!
}

start_tail() {
  touch "$ACCESS_LOG"
  chown egressproxy:egressproxy "$ACCESS_LOG"
  tail -n 0 -F "$ACCESS_LOG" 2>/dev/null &
  TAIL_PID=$!
}

stop_pid() {
  local pid="$1"

  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    kill -TERM "$pid" 2>/dev/null || true

    for _ in $(seq 1 20); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.1
    done

    kill -KILL "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  fi
}

reload_services() {
  local dir revision
  dir="$(config_dir)"
  revision="$(sed -n 's/.*"revision":"\([^"]*\)".*/\1/p' "$dir/policy.json" 2>/dev/null | head -n 1)"

  # dnsmasq does not re-read its configuration on SIGHUP: restart it.
  stop_pid "$DNSMASQ_PID"
  start_dnsmasq

  # Squid listeners never change; a full restart keeps behaviour simple and deterministic.
  stop_pid "$SQUID_PID"
  rm -f -- "$RUN_DIR/squid.pid"
  start_squid

  printf '%s' "$revision" > "$RUN_DIR/applied"
  emit policy_applied "${revision:-default}"
}

on_hup() {
  RELOAD_REQUESTED=1
}

on_term() {
  STOPPING=1
}

trap on_hup HUP
trap on_term TERM INT

install -d -m 0750 -o root -g egressproxy "$STATE_DIR"
install -d -m 0755 "$RUN_DIR"
install -d -m 0750 -o egressproxy -g egressproxy "$LOG_DIR"

if ! "$CLI" lockdown; then
  emit lockdown_failed "netfilter lockdown could not be installed (CAP_NET_ADMIN missing?)"
  exit 1
fi

if [ ! -s "$STATE_DIR/bootstrap.pem" ]; then
  # Only used to initialise the TLS intercept listener; connections are spliced or terminated,
  # so this certificate is never presented to (or trusted by) the agent.
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj "/CN=agenstra-egress-guard" \
    -keyout "$STATE_DIR/bootstrap.pem" -out "$STATE_DIR/bootstrap.crt" >/dev/null 2>&1 \
    && cat "$STATE_DIR/bootstrap.crt" >> "$STATE_DIR/bootstrap.pem" \
    && rm -f -- "$STATE_DIR/bootstrap.crt"
  chown root:egressproxy "$STATE_DIR/bootstrap.pem"
  chmod 0640 "$STATE_DIR/bootstrap.pem"
fi

printf '%s' "$$" > "$RUN_DIR/supervisor.pid"

if [ -d "$ACTIVE" ]; then
  if ! "$CLI" activate --no-reload; then
    emit activate_failed "stored policy could not be re-applied; guard stays locked down"
    "$CLI" lockdown || true
  fi
fi

start_tail
start_dnsmasq
start_squid
printf '%s' "$(sed -n 's/.*"revision":"\([^"]*\)".*/\1/p' "$(config_dir)/policy.json" 2>/dev/null | head -n 1)" \
  > "$RUN_DIR/applied"
emit started "$(squid -v 2>/dev/null | head -n 1)"

while [ "$STOPPING" -eq 0 ]; do
  sleep 1 &
  wait $! 2>/dev/null || true

  if [ "$STOPPING" -ne 0 ]; then
    break
  fi

  if [ "$RELOAD_REQUESTED" -eq 1 ]; then
    RELOAD_REQUESTED=0
    reload_services
    continue
  fi

  if [ -n "$SQUID_PID" ] && ! kill -0 "$SQUID_PID" 2>/dev/null; then
    emit process_restarted "squid exited: $(tail -n 3 "$LOG_DIR/cache.log" 2>/dev/null | tr '\n' ' ' | cut -c1-300)"
    rm -f -- "$RUN_DIR/squid.pid"
    sleep 1
    start_squid
  fi

  if [ -n "$DNSMASQ_PID" ] && ! kill -0 "$DNSMASQ_PID" 2>/dev/null; then
    emit process_restarted "dnsmasq exited"
    sleep 1
    start_dnsmasq
  fi

  if [ -n "$TAIL_PID" ] && ! kill -0 "$TAIL_PID" 2>/dev/null; then
    start_tail
  fi

  size="$(stat -c %s "$ACCESS_LOG" 2>/dev/null || echo 0)"

  if [ "$size" -gt "$ROTATE_BYTES" ]; then
    squid -k rotate -f "$(config_dir)/squid.conf" >/dev/null 2>&1 || true
  fi

  # Keep Squid's own diagnostics bounded as well.
  for file in "$LOG_DIR/cache.log" "$LOG_DIR/squid.stdout"; do
    if [ "$(stat -c %s "$file" 2>/dev/null || echo 0)" -gt "$ROTATE_BYTES" ]; then
      : > "$file"
    fi
  done
done

stop_pid "$SQUID_PID"
stop_pid "$DNSMASQ_PID"
stop_pid "$TAIL_PID"
exit 0
