#!/usr/bin/env bash
# Loadweaver node components for an imported host (join plan step "components"); idempotent.
set -euo pipefail
. /etc/os-release
case "$ID:$VERSION_ID" in
  debian:12|debian:13|ubuntu:22.04|ubuntu:24.04) ;;
  *) echo "loadweaver-components: unsupported OS $ID $VERSION_ID" >&2; exit 1 ;;
esac
export DEBIAN_FRONTEND=noninteractive
LW_APT_UPDATED=""
# Installs the packages (name or name=version) that are missing or at another version; nothing when all are there.
lw_apt_install() {
  local missing=() spec name want have
  for spec in "$@"; do
    name="${spec%%=*}"; want=""; [ "$name" = "$spec" ] || want="${spec#*=}"
    have="$(dpkg-query -W -f='${db:Status-Status} ${Version}' "$name" 2>/dev/null || true)"
    case "$have" in
      "installed "*) [ -z "$want" ] || [ "${have#installed }" = "$want" ] || missing+=("$spec") ;;
      *) missing+=("$spec") ;;
    esac
  done
  [ ${#missing[@]} -eq 0 ] && return 0
  [ -n "$LW_APT_UPDATED" ] || { apt-get update -q; LW_APT_UPDATED=1; }
  apt-get install -y -q --no-install-recommends "${missing[@]}"
}
lw_apt_install ca-certificates curl gnupg jq iproute2 wireguard-tools nftables bird2 keepalived rsync

# Replicated volumes (LVM thin -> LUKS2 -> DRBD 9): userland pinned to the tested versions.
case "$ID:$VERSION_ID" in
  debian:13) LW_STORAGE_PACKAGES=("lvm2=2.03.31-2" "cryptsetup=2:2.7.5-2" "drbd-utils=9.22.0-1.1" "thin-provisioning-tools=1.1.0-4+b1") ;;
  debian:12) LW_STORAGE_PACKAGES=("lvm2=2.03.16-2" "cryptsetup=2:2.6.1-4~deb12u2" "drbd-utils=9.22.0-1" "thin-provisioning-tools=0.9.0-2") ;;
  ubuntu:24.04) LW_STORAGE_PACKAGES=("lvm2=2.03.16-3ubuntu3.2" "cryptsetup=2:2.7.0-1ubuntu4.2" "drbd-utils=9.22.0-1build1" "thin-provisioning-tools=0.9.0-2ubuntu5.1") ;;
  ubuntu:22.04) LW_STORAGE_PACKAGES=("lvm2=2.03.11-2.1ubuntu5" "cryptsetup=2:2.4.3-1ubuntu1.3" "drbd-utils=9.15.0-1ubuntu0.1" "thin-provisioning-tools=0.9.0-2ubuntu1") ;;
esac
lw_apt_install "${LW_STORAGE_PACKAGES[@]}"
# The DRBD 9 kernel module (built and signed for Secure Boot) comes with the Loadweaver release bundle; distribution
# kernels ship DRBD 8.4. The agent reports whether DRBD 9 is loadable (capability drbd9); without it the control
# plane places no volumes on this node.
if [ "$(modinfo -F version drbd 2>/dev/null | cut -d. -f1)" -ge 9 ] 2>/dev/null; then
  echo drbd > /etc/modules-load.d/loadweaver-drbd.conf
  modprobe drbd
else
  echo "loadweaver-install: no DRBD 9 kernel module on this host; it gets no volume replicas until one is installed" >&2
fi

# Docker Engine with live-restore, so agent and daemon upgrades never stop workloads (3.26).
if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/$ID/gpg" | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/$ID $VERSION_CODENAME stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get install -y -q --no-install-recommends docker-ce docker-ce-cli containerd.io
fi
mkdir -p /etc/docker
[ -s /etc/docker/daemon.json ] || echo '{}' > /etc/docker/daemon.json
jq '.["live-restore"] = true' /etc/docker/daemon.json > /etc/docker/daemon.json.loadweaver
mv /etc/docker/daemon.json.loadweaver /etc/docker/daemon.json
systemctl enable --now docker
systemctl reload docker || { echo "loadweaver-components: Docker did not reload (live-restore); not restarting a host that runs containers" >&2; exit 1; }

# Container isolation: install gVisor (sandboxed level). Optional and never fatal: on any failure the
# runtime registration is rolled back and the host keeps running environments with standard Docker (runc).
agenstra_prepare_gvisor() {
set +e
AGENSTRA_GVISOR_RELEASE="$(printf '%s' "${GVISOR_RELEASE:-20261012.0}")"
AGENSTRA_GVISOR_RUNTIME="runsc-systrap"
AGENSTRA_GVISOR_HOSTNET_RUNTIME="runsc-systrap-hostnet"
AGENSTRA_GVISOR_VERIFY_IMAGE="hello-world"
AGENSTRA_GVISOR_PINNED_RELEASE="20261012.0"
AGENSTRA_GVISOR_SHA512_X86_64="9606445eed5aedfcf05310e7ccef61d994089914c6622fc82624c24d2b18db1b2210f40e40a7be27b8b7772859de7d95c501b4eba66423053c960bf671377c5e"
AGENSTRA_GVISOR_SHA512_AARCH64="2fe7425abd16ad6ca649ab9bc3d7e8e76756834d86ffcc08dbe97c82c3b7262a7d6401f23632f2b296649cc1408b560416b2ab65a4043aa123fc7b90f3a1b2e2"
AGENSTRA_GVISOR_PREFIX="/usr/local/lib/agenstra-gvisor"
AGENSTRA_GVISOR_PREVIOUS=""
AGENSTRA_GVISOR_NEW_TARGET=""
AGENSTRA_DOCKER_DAEMON_JSON="/etc/docker/daemon.json"
AGENSTRA_DOCKER_DAEMON_BACKUP="/etc/docker/daemon.json.agenstra-gvisor.bak"
AGENSTRA_DOCKER_RESTART_ALLOWED="1"

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
agenstra_gvisor_install
}
if ( agenstra_prepare_gvisor ); then
    echo "gVisor sandbox runtime installed"
else
    echo "gVisor sandbox runtime not installed; environments use standard Docker (runc)"
fi
for agenstra_docker_wait_i in $(seq 1 60); do
    docker info >/dev/null 2>&1 && break
    sleep 2
done
docker info >/dev/null 2>&1 || { echo "ERROR: Docker is not working after gVisor preparation"; exit 1; }

# OS updates are orchestrated by Loadweaver (3.26: drain → update → reboot, from the cluster-local apt snapshot), so
# reboots never happen uncoordinated: no unattended upgrades of their own.
systemctl disable --now unattended-upgrades.service apt-daily-upgrade.timer >/dev/null 2>&1 || true
# Kernel features for the overlay: WireGuard, forwarding for IPv4 and IPv6.
modprobe wireguard
cat > /etc/sysctl.d/90-loadweaver.conf <<'SYSCTL'
net.ipv4.ip_forward = 1
net.ipv6.conf.all.forwarding = 1
# The ingress listens on failover addresses this node may not hold right now (3.6).
net.ipv4.ip_nonlocal_bind = 1
net.ipv6.ip_nonlocal_bind = 1
SYSCTL
sysctl --system >/dev/null

systemctl enable --now bird
# keepalived starts once the agent writes a configuration with VRRP addresses (3.6).
mkdir -p /etc/keepalived
systemctl enable keepalived

echo "loadweaver-components: installed"
