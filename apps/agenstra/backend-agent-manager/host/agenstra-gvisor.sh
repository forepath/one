#!/usr/bin/env bash
# Agenstra container isolation host preparation (gVisor / runsc, systrap platform).
#
# GENERATED from libs/domains/shared/backend/util-container-runtime (buildGvisorHostScript) - do not edit.
#
# Usage: agenstra-gvisor.sh check|install|uninstall [--json]
#   check      Report Docker/runc baseline and gVisor runtime state (no changes).
#   install    Install the pinned, checksum-verified gVisor release and register the Docker runtimes
#              'runsc-systrap' (--platform=systrap) and 'runsc-systrap-hostnet' (--platform=systrap
#              --network=host, for workers behind an egress guard). Docker's default runtime stays runc.
#              Docker is only reloaded (never restarted). Rolled back on failure.
#   uninstall  Remove the runtime registrations (installed binaries stay under /usr/local/lib/agenstra-gvisor).
# Environment: GVISOR_RELEASE (default 20261005.0), GVISOR_SHA512 (required for non-default releases).
#
# Exit codes: 0 ok, 2 usage, 3 not root, 40 Docker/runc baseline unavailable (E_DOCKER_BASELINE_UNAVAILABLE),
#             41 unsupported host, 42 install failed (rolled back), 43 runtime not ready.
# After changes, restart the agent manager or call POST /api/isolation/probe so it re-probes the host.
set -uo pipefail

AGENSTRA_GVISOR_RELEASE="$(printf '%s' "${GVISOR_RELEASE:-20261005.0}")"
AGENSTRA_GVISOR_RUNTIME="runsc-systrap"
AGENSTRA_GVISOR_HOSTNET_RUNTIME="runsc-systrap-hostnet"
AGENSTRA_GVISOR_VERIFY_IMAGE="hello-world"
AGENSTRA_GVISOR_PINNED_RELEASE="20261005.0"
AGENSTRA_GVISOR_SHA512_X86_64="79869ae9a589355a46d46fdac068d9a954e741741ffe77c64e38c56ea955498c1cb04e9bce44e1cce5155333e6b76bee72347c6661bb7c78fd2fe3aad198c8fe"
AGENSTRA_GVISOR_SHA512_AARCH64="1bc58be6f881264ced1df8ff61db0205531abedcace005585ac5637c5c987831062b365f99f270ef0939849f130344b84e0f1a663294406f798b8f7c8cd326ac"
AGENSTRA_GVISOR_PREFIX="/usr/local/lib/agenstra-gvisor"
AGENSTRA_GVISOR_PREVIOUS=""
AGENSTRA_GVISOR_NEW_TARGET=""
AGENSTRA_DOCKER_DAEMON_JSON="/etc/docker/daemon.json"
AGENSTRA_DOCKER_DAEMON_BACKUP="/etc/docker/daemon.json.agenstra-gvisor.bak"
AGENSTRA_DOCKER_RESTART_ALLOWED="0"

agenstra_gvisor_log() { echo "[agenstra-gvisor] $*" >&2; }

agenstra_gvisor_arch() {
  case "$(uname -m)" in
    x86_64|amd64) echo x86_64 ;;
    aarch64|arm64) echo aarch64 ;;
    *) echo unsupported ;;
  esac
}

# gVisor requires Linux 5.6+ (systrap platform, no KVM needed).
agenstra_gvisor_kernel_supported() {
  local major minor
  major="$(uname -r | cut -d. -f1)"
  minor="$(uname -r | cut -d. -f2 | sed 's/[^0-9].*//')"
  [ -n "$major" ] && [ -n "$minor" ] || return 1
  [ "$major" -gt 5 ] || { [ "$major" -eq 5 ] && [ "$minor" -ge 6 ]; }
}

agenstra_docker_ready() { docker info >/dev/null 2>&1; }

agenstra_docker_wait() {
  local i
  for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30; do
    agenstra_docker_ready && return 0
    sleep 2
  done
  return 1
}

# Runtimes are reloadable daemon configuration (SIGHUP); running containers are not affected.
agenstra_docker_reload() {
  if ! systemctl reload docker >/dev/null 2>&1; then
    if [ "$AGENSTRA_DOCKER_RESTART_ALLOWED" != "1" ]; then
      agenstra_gvisor_log "Docker reload failed (not restarting a running host; reload or restart Docker manually)"
      return 1
    fi
    systemctl restart docker >/dev/null 2>&1 || return 1
  fi
  agenstra_docker_wait
}

agenstra_gvisor_runtime_registered() {
  local runtimes
  runtimes="$(docker info --format '{{json .Runtimes}}' 2>/dev/null)" || return 1
  printf '%s' "$runtimes" | grep -q "\"$AGENSTRA_GVISOR_RUNTIME\"" &&
    printf '%s' "$runtimes" | grep -q "\"$AGENSTRA_GVISOR_HOSTNET_RUNTIME\""
}

# Smoke test of runc and both gVisor runtimes. The agent manager runs the full probe afterwards; when
# the smoke image cannot be pulled (restricted registries) only the registration is verified.
agenstra_gvisor_verify() {
  agenstra_gvisor_runtime_registered || return 1
  if ! docker image inspect "$AGENSTRA_GVISOR_VERIFY_IMAGE" >/dev/null 2>&1 &&
    ! docker pull -q "$AGENSTRA_GVISOR_VERIFY_IMAGE" >/dev/null 2>&1; then
    agenstra_gvisor_log "Smoke test image unavailable; skipping container smoke test (the agent manager probe verifies the runtime)"
    return 0
  fi
  docker run --rm --runtime=runc --network=none "$AGENSTRA_GVISOR_VERIFY_IMAGE" >/dev/null 2>&1 || return 1
  docker run --rm --runtime="$AGENSTRA_GVISOR_RUNTIME" --network=none "$AGENSTRA_GVISOR_VERIFY_IMAGE" >/dev/null 2>&1 || return 1
  docker run --rm --runtime="$AGENSTRA_GVISOR_HOSTNET_RUNTIME" --network=none "$AGENSTRA_GVISOR_VERIFY_IMAGE" >/dev/null 2>&1
}

agenstra_gvisor_unregister() {
  local runsc="$1"
  [ -x "$runsc" ] || return 0
  "$runsc" uninstall --runtime="$AGENSTRA_GVISOR_RUNTIME" >/dev/null 2>&1 || true
  "$runsc" uninstall --runtime="$AGENSTRA_GVISOR_HOSTNET_RUNTIME" >/dev/null 2>&1 || true
}

# Restore daemon.json and the previously active release (symlinks); remove a newly extracted release.
agenstra_gvisor_rollback() {
  agenstra_gvisor_log "Rolling back gVisor runtime registration"
  if [ -f "$AGENSTRA_DOCKER_DAEMON_BACKUP" ]; then
    cp -p "$AGENSTRA_DOCKER_DAEMON_BACKUP" "$AGENSTRA_DOCKER_DAEMON_JSON"
  else
    agenstra_gvisor_unregister "$AGENSTRA_GVISOR_PREFIX/current/runsc"
  fi
  if [ -n "$AGENSTRA_GVISOR_PREVIOUS" ] && [ -d "$AGENSTRA_GVISOR_PREVIOUS" ]; then
    ln -sfn "$AGENSTRA_GVISOR_PREVIOUS" "$AGENSTRA_GVISOR_PREFIX/current"
  else
    rm -f "$AGENSTRA_GVISOR_PREFIX/current" /usr/local/bin/runsc /usr/local/bin/containerd-shim-runsc-v1
  fi
  if [ -n "$AGENSTRA_GVISOR_NEW_TARGET" ]; then
    rm -rf "$AGENSTRA_GVISOR_NEW_TARGET"
  fi
  agenstra_docker_reload || agenstra_gvisor_log "WARNING: Docker reload after rollback failed"
}

# Install the pinned release (checksum verified) and register the systrap runtimes: one with gVisor's
# own network stack and one with the namespace network stack for workers behind an egress guard.
# Returns 0 when gVisor is ready, 1 when it was skipped or rolled back (Docker/runc stays untouched).
agenstra_gvisor_install() {
  local arch expected url workdir target staging
  if ! agenstra_docker_ready; then
    agenstra_gvisor_log "Docker is not ready; skipping gVisor"
    return 1
  fi
  arch="$(agenstra_gvisor_arch)"
  if [ "$arch" = "unsupported" ] || ! agenstra_gvisor_kernel_supported; then
    agenstra_gvisor_log "Unsupported architecture or kernel (needs x86_64/aarch64 and Linux 5.6+); skipping gVisor"
    return 1
  fi
  case "$AGENSTRA_GVISOR_RELEASE" in
    *[!0-9.]*|"") agenstra_gvisor_log "Invalid GVISOR_RELEASE"; return 1 ;;
  esac
  if [ "$arch" = "x86_64" ]; then expected="$AGENSTRA_GVISOR_SHA512_X86_64"; else expected="$AGENSTRA_GVISOR_SHA512_AARCH64"; fi
  if [ "$AGENSTRA_GVISOR_RELEASE" != "$AGENSTRA_GVISOR_PINNED_RELEASE" ]; then
    expected="$(printf '%s' "${GVISOR_SHA512:-}" | tr 'A-F' 'a-f')"
  fi
  if ! printf '%s' "$expected" | grep -Eq '^[a-f0-9]{128}$'; then
    agenstra_gvisor_log "No pinned SHA-512 for gVisor $AGENSTRA_GVISOR_RELEASE/$arch (set GVISOR_SHA512); skipping gVisor"
    return 1
  fi
  target="$AGENSTRA_GVISOR_PREFIX/$AGENSTRA_GVISOR_RELEASE"
  AGENSTRA_GVISOR_PREVIOUS="$(readlink "$AGENSTRA_GVISOR_PREFIX/current" 2>/dev/null || true)"
  mkdir -p "$AGENSTRA_GVISOR_PREFIX"
  if [ ! -x "$target/runsc" ]; then
    url="https://storage.googleapis.com/gvisor/releases/release/$AGENSTRA_GVISOR_RELEASE/$arch/gvisor.tar.bz2"
    workdir="$(mktemp -d)"
    agenstra_gvisor_log "Downloading gVisor $AGENSTRA_GVISOR_RELEASE ($arch)"
    if ! curl -fsSL --retry 3 -o "$workdir/gvisor.tar.bz2" "$url"; then
      rm -rf "$workdir"; agenstra_gvisor_log "Download failed; skipping gVisor"; return 1
    fi
    if ! echo "$expected  $workdir/gvisor.tar.bz2" | sha512sum -c - >/dev/null 2>&1; then
      rm -rf "$workdir"; agenstra_gvisor_log "Checksum mismatch; skipping gVisor"; return 1
    fi
    # Extract into a staging directory and move it into place only when complete.
    staging="$(mktemp -d "$AGENSTRA_GVISOR_PREFIX/.staging-XXXXXX")"
    if ! tar -xjf "$workdir/gvisor.tar.bz2" -C "$staging" --no-same-owner || [ ! -x "$staging/runsc" ]; then
      rm -rf "$workdir" "$staging"; agenstra_gvisor_log "Extraction failed; skipping gVisor"; return 1
    fi
    rm -rf "$workdir" "$target"
    chown -R root:root "$staging"
    chmod -R go-w "$staging"
    chmod 755 "$staging"
    mv "$staging" "$target"
    AGENSTRA_GVISOR_NEW_TARGET="$target"
  fi
  mkdir -p "$(dirname "$AGENSTRA_DOCKER_DAEMON_JSON")"
  if [ -f "$AGENSTRA_DOCKER_DAEMON_JSON" ]; then
    cp -p "$AGENSTRA_DOCKER_DAEMON_JSON" "$AGENSTRA_DOCKER_DAEMON_BACKUP"
  else
    rm -f "$AGENSTRA_DOCKER_DAEMON_BACKUP"
  fi
  ln -sfn "$target" "$AGENSTRA_GVISOR_PREFIX/current"
  ln -sf "$AGENSTRA_GVISOR_PREFIX/current/runsc" /usr/local/bin/runsc
  ln -sf "$AGENSTRA_GVISOR_PREFIX/current/containerd-shim-runsc-v1" /usr/local/bin/containerd-shim-runsc-v1
  # Merges only these runtime entries into daemon.json; Docker's default runtime stays runc.
  if ! "$target/runsc" install --runtime="$AGENSTRA_GVISOR_RUNTIME" -- --platform=systrap >/dev/null 2>&1 ||
    ! "$target/runsc" install --runtime="$AGENSTRA_GVISOR_HOSTNET_RUNTIME" -- --platform=systrap --network=host >/dev/null 2>&1; then
    agenstra_gvisor_log "Runtime registration failed"
    agenstra_gvisor_rollback
    return 1
  fi
  if ! agenstra_docker_reload || ! agenstra_gvisor_verify; then
    agenstra_gvisor_log "gVisor verification failed"
    agenstra_gvisor_rollback
    return 1
  fi
  rm -f "$AGENSTRA_DOCKER_DAEMON_BACKUP"
  agenstra_gvisor_log "gVisor runtimes '$AGENSTRA_GVISOR_RUNTIME' and '$AGENSTRA_GVISOR_HOSTNET_RUNTIME' are ready"
  return 0
}

agenstra_gvisor_report() {
  local baseline="$1" sandboxed="$2" json="$3"
  if [ "$json" = "1" ]; then
    printf '{"runtime":"%s","sharedNetnsRuntime":"%s","release":"%s","standard":"%s","sandboxed":"%s"}\n' "$AGENSTRA_GVISOR_RUNTIME" "$AGENSTRA_GVISOR_HOSTNET_RUNTIME" "$AGENSTRA_GVISOR_RELEASE" "$baseline" "$sandboxed"
  else
    echo "Standard (runc): $baseline"
    echo "Sandboxed ($AGENSTRA_GVISOR_RUNTIME, $AGENSTRA_GVISOR_HOSTNET_RUNTIME): $sandboxed"
  fi
}

main() {
  local command="${1:-}" json=0 baseline=unavailable sandboxed=unsupported
  [ "${2:-}" = "--json" ] && json=1
  case "$command" in
    check|install|uninstall) ;;
    *) echo "Usage: $0 check|install|uninstall [--json]" >&2; return 2 ;;
  esac
  if [ "$(id -u)" -ne 0 ] && [ "$command" != "check" ]; then
    echo "This command must run as root" >&2; return 3
  fi
  if ! agenstra_docker_ready; then
    agenstra_gvisor_report "$baseline" "$sandboxed" "$json"
    return 40
  fi
  baseline=ready
  case "$command" in
    check)
      if agenstra_gvisor_runtime_registered; then sandboxed=registered; fi
      agenstra_gvisor_report "$baseline" "$sandboxed" "$json"
      [ "$sandboxed" = "registered" ] && return 0 || return 43
      ;;
    install)
      if [ "$(agenstra_gvisor_arch)" = "unsupported" ] || ! agenstra_gvisor_kernel_supported; then
        agenstra_gvisor_report "$baseline" unsupported "$json"; return 41
      fi
      if agenstra_gvisor_install; then
        agenstra_gvisor_report "$baseline" ready "$json"; return 0
      fi
      agenstra_docker_ready || { agenstra_gvisor_report unavailable install-failed "$json"; return 40; }
      agenstra_gvisor_report "$baseline" install-failed "$json"; return 42
      ;;
    uninstall)
      # Only the runtime entries are removed; other daemon.json changes made since the install are kept.
      agenstra_gvisor_unregister "$AGENSTRA_GVISOR_PREFIX/current/runsc"
      agenstra_docker_reload || true
      rm -f "$AGENSTRA_DOCKER_DAEMON_BACKUP"
      agenstra_docker_ready || { agenstra_gvisor_report unavailable unsupported "$json"; return 40; }
      agenstra_gvisor_report "$baseline" unsupported "$json"; return 0
      ;;
  esac
}

main "$@"
