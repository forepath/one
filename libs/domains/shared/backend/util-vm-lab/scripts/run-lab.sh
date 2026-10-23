#!/usr/bin/env bash
# Runs one VM lab suite (or a filtered part of it) the way this machine needs it (WSL protection):
#   1. under the heavy lock (/tmp/lw-3a-lock.sh = flock on /tmp/lw-3a.lock; taken here unless a parent holds it),
#   2. with enough memory (MemAvailable ≥ --min-available-mb, default 8192) and disk (≥ 30 GiB free on /),
#   3. holding /tmp/lw-vmlab.lock (created with noclobber; only this run's token is ever removed),
#   4. with a watchdog that stops the run when MemAvailable drops below 3 GiB, and a timeout,
#   5. cleaning up the lab's containers / run volumes afterwards (golden volumes stay).
#
# usage: run-lab.sh --config <jest config> --label <docker label> [--min-available-mb N] [--timeout-min N]
#                   [--cleanup-args "<extra cleanup.sh args>"] [--spec <pattern>] [--] [<spec pattern>…]
# Spec patterns are Jest path patterns (e.g. `microvm`, `spikes/s1-`); none = the whole suite.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../../../../.." && pwd)"
HEAVY_SCRIPT=/tmp/lw-3a-lock.sh
HEAVY_LOCK=/tmp/lw-3a.lock
LAB_LOCK=/tmp/lw-vmlab.lock

config=""
label=""
min_mb=8192
timeout_min=360
cleanup_args=""
patterns=()
orig_args=("$@")
while [ $# -gt 0 ]; do
  case "$1" in
    --config) config="$2"; shift 2 ;;
    --label) label="$2"; shift 2 ;;
    --min-available-mb) min_mb="$2"; shift 2 ;;
    --timeout-min) timeout_min="$2"; shift 2 ;;
    --cleanup-args) cleanup_args="$2"; shift 2 ;;
    --spec) [ -n "$2" ] && patterns+=("$2"); shift 2 ;;
    --spec=*) [ -n "${1#--spec=}" ] && patterns+=("${1#--spec=}"); shift ;;
    --) shift; while [ $# -gt 0 ]; do [ -n "$1" ] && patterns+=("$1"); shift; done ;;
    *) patterns+=("$1"); shift ;;
  esac
done
[ -n "$config" ] && [ -n "$label" ] || { echo "run-lab.sh: --config and --label are required" >&2; exit 2; }

# 1. Heavy lock: re-run this script under it (a parent may hold it already: LW_HEAVY_LOCK_HELD=1).
if [ "${LW_HEAVY_LOCK_HELD:-}" != "1" ]; then
  echo "[run-lab] waiting for the heavy lock ($HEAVY_LOCK)…" >&2
  if [ -x "$HEAVY_SCRIPT" ]; then
    exec "$HEAVY_SCRIPT" env LW_HEAVY_LOCK_HELD=1 bash "${BASH_SOURCE[0]}" "${orig_args[@]}"
  fi
  exec flock -w 3600 "$HEAVY_LOCK" env LW_HEAVY_LOCK_HELD=1 bash "${BASH_SOURCE[0]}" "${orig_args[@]}"
fi

# 2. Memory and disk.
avail_mb=$(awk '/^MemAvailable:/ { print int($2 / 1024) }' /proc/meminfo)
if [ "${VM_LAB_SKIP_MEMORY_CHECK:-}" != "1" ] && [ "$avail_mb" -lt "$min_mb" ]; then
  echo "[run-lab] only ${avail_mb} MiB available, the lab needs ${min_mb} MiB (VM_LAB_SKIP_MEMORY_CHECK=1 overrides)" >&2
  exit 1
fi
free_gb=$(df -BG --output=avail / | tail -n1 | tr -dc '0-9')
if [ "${VM_LAB_SKIP_DISK_CHECK:-}" != "1" ] && [ "${free_gb:-0}" -lt 30 ]; then
  echo "[run-lab] only ${free_gb} GiB free on /, the lab needs 30 GiB (VM_LAB_SKIP_DISK_CHECK=1 overrides)" >&2
  exit 1
fi

# 3. VM lab lock (atomic noclobber create; only our token is removed).
token="$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')"
if ! (set -o noclobber; printf 'token=%s\npid=%s\nhost=%s\nlabel=%s\nstarted=%s\n' \
  "$token" "$$" "$(hostname)" "$label" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$LAB_LOCK") 2>/dev/null; then
  echo "[run-lab] $LAB_LOCK is held:" >&2
  sed 's/^/[run-lab]   /' "$LAB_LOCK" >&2 || true
  echo "[run-lab] one VM lab at a time; if its pid no longer runs, check 'docker ps --filter label=$label' and remove the lock by hand" >&2
  exit 1
fi
export LW_VMLAB_LOCK_TOKEN="$token"

jest_pid=""
watchdog_pid=""
finish() {
  local status=$?
  [ -z "$watchdog_pid" ] || kill "$watchdog_pid" 2>/dev/null || true
  [ -z "$jest_pid" ] || kill "$jest_pid" 2>/dev/null || true
  # shellcheck disable=SC2086 # extra args are word-split on purpose
  bash "$HERE/cleanup.sh" --label "$label" $cleanup_args || true
  if [ "$(sed -n 's/^token=//p' "$LAB_LOCK" 2>/dev/null || true)" = "$token" ]; then rm -f "$LAB_LOCK"; fi
  exit "$status"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# 4. The suite, in band, with a watchdog and a timeout.
cd "$ROOT"
echo "[run-lab] $(date -u +%H:%M:%S) jest -c $config --runInBand ${patterns[*]:-(all)}; ${avail_mb} MiB available" >&2
NX_DAEMON=false timeout --signal=TERM "${timeout_min}m" npx jest -c "$config" --runInBand "${patterns[@]}" &
jest_pid=$!
(
  while kill -0 "$jest_pid" 2>/dev/null; do
    now=$(awk '/^MemAvailable:/ { print int($2 / 1024) }' /proc/meminfo)
    if [ "$now" -lt 3072 ]; then
      echo "[run-lab] watchdog: MemAvailable ${now} MiB < 3072 MiB — stopping the lab" >&2
      kill -TERM "$jest_pid" 2>/dev/null || true
      exit 0
    fi
    sleep 10
  done
) &
watchdog_pid=$!
set +e
wait "$jest_pid"
status=$?
set -e
jest_pid=""
echo "[run-lab] $(date -u +%H:%M:%S) jest exited with $status" >&2
exit "$status"
