/**
 * gVisor (`runsc`) host preparation for Agenstra workspace hosts.
 *
 * The sandboxed container isolation level runs agent workers on gVisor's systrap platform, registered
 * as a dedicated Docker runtime. The sandboxed-kvm level runs them on gVisor's KVM platform (hardware
 * virtualization, `/dev/kvm`), registered as a second runtime pair only when the host supports KVM.
 * Installing either is optional and never fatal: Docker's default runtime stays `runc` (the mandatory
 * standard floor), every step is verified, and a failed installation is rolled back (a failed KVM step
 * only rolls back the KVM runtimes). The agent manager only offers a level after its own runtime probe
 * passed.
 */

/** Pinned gVisor release (release archives: `gvisor.tar.bz2` containing `runsc` and its helpers). */
export const GVISOR_DEFAULT_RELEASE = '20261005.0';

/** SHA-512 of `gvisor.tar.bz2` of {@link GVISOR_DEFAULT_RELEASE} per architecture (pinned in code). */
export const GVISOR_DEFAULT_RELEASE_SHA512: Readonly<Record<'x86_64' | 'aarch64', string>> = {
  x86_64:
    '79869ae9a589355a46d46fdac068d9a954e741741ffe77c64e38c56ea955498c1cb04e9bce44e1cce5155333e6b76bee72347c6661bb7c78fd2fe3aad198c8fe',
  aarch64:
    '1bc58be6f881264ced1df8ff61db0205531abedcace005585ac5637c5c987831062b365f99f270ef0939849f130344b84e0f1a663294406f798b8f7c8cd326ac',
};

/** Docker runtime name of the sandboxed isolation level (gVisor Netstack networking). */
export const GVISOR_SANDBOX_RUNTIME_NAME = 'runsc-systrap';

/**
 * Docker runtime name of the sandboxed level for workers joining their egress guard's network
 * namespace (`--network=host`: the namespace's kernel stack, so the guard's netfilter rules and
 * loopback proxy apply; Netstack would bypass them).
 */
export const GVISOR_SANDBOX_SHARED_NETNS_RUNTIME_NAME = 'runsc-systrap-hostnet';

/** Docker runtime name of the sandboxed-kvm isolation level (gVisor KVM platform, Netstack networking). */
export const GVISOR_SANDBOX_KVM_RUNTIME_NAME = 'runsc-kvm';

/**
 * Docker runtime name of the sandboxed-kvm level for workers joining their egress guard's network
 * namespace or a user-defined Docker network (`--platform=kvm --network=host`).
 */
export const GVISOR_SANDBOX_KVM_SHARED_NETNS_RUNTIME_NAME = 'runsc-kvm-hostnet';

/** gVisor platform a runtime pair is registered with. */
export type GvisorPlatform = 'systrap' | 'kvm';

/** Runtime pair (Netstack + kernel network stack variant) registered for one gVisor platform. */
export interface GvisorRuntimePair {
  platform: GvisorPlatform;
  /** Runtime with gVisor's own network stack (Netstack), for workers on Docker's default bridge. */
  runtime: string;
  /** Runtime with `--network=host` (the namespace's kernel stack), for guarded / agent-network workers. */
  sharedNetnsRuntime: string;
}

/** Default gVisor runtime catalog registered by the host preparation (single source of the names). */
export const GVISOR_RUNTIMES: Readonly<Record<GvisorPlatform, GvisorRuntimePair>> = {
  systrap: {
    platform: 'systrap',
    runtime: GVISOR_SANDBOX_RUNTIME_NAME,
    sharedNetnsRuntime: GVISOR_SANDBOX_SHARED_NETNS_RUNTIME_NAME,
  },
  kvm: {
    platform: 'kvm',
    runtime: GVISOR_SANDBOX_KVM_RUNTIME_NAME,
    sharedNetnsRuntime: GVISOR_SANDBOX_KVM_SHARED_NETNS_RUNTIME_NAME,
  },
};

/** Stable exit codes of the standalone host script. */
export const GVISOR_HOST_SCRIPT_EXIT_CODES = {
  OK: 0,
  USAGE: 2,
  NOT_ROOT: 3,
  DOCKER_BASELINE_UNAVAILABLE: 40,
  GVISOR_UNSUPPORTED_HOST: 41,
  GVISOR_INSTALL_FAILED: 42,
  GVISOR_VERIFY_FAILED: 43,
} as const;

export interface GvisorInstallScriptOptions {
  /** gVisor release id (defaults to {@link GVISOR_DEFAULT_RELEASE}). */
  release?: string;
  /** Expected archive SHA-512 per architecture (defaults to the pinned hashes of the default release). */
  sha512?: Partial<Record<'x86_64' | 'aarch64', string>>;
  /** Docker runtime name to register (defaults to {@link GVISOR_SANDBOX_RUNTIME_NAME}). */
  runtimeName?: string;
  /** Runtime name of the egress-guard compatible variant (defaults to {@link GVISOR_SANDBOX_SHARED_NETNS_RUNTIME_NAME}). */
  sharedNetnsRuntimeName?: string;
  /** Image used for the post-install smoke test (defaults to `hello-world`). */
  verifyImage?: string;
  /**
   * Prepare KVM and register the sandboxed-kvm runtime pair when the host supports hardware
   * virtualization (default `true`; the KVM step is always optional and never affects systrap).
   */
  kvm?: boolean;
  /**
   * Let the KVM preparation install the distribution's extra kernel modules (`linux-modules-extra-$(uname -r)`) from
   * the host's apt sources when the KVM module is missing (default `true`; env `AGENSTRA_KVM_APT`). Hosts whose
   * packages come from a pinned snapshot (Loadweaver) install that package themselves and pass `false`: then a
   * missing module only makes KVM unavailable, nothing is installed.
   */
  kvmApt?: boolean;
  /** KVM runtime name to register (defaults to {@link GVISOR_SANDBOX_KVM_RUNTIME_NAME}). */
  kvmRuntimeName?: string;
  /** KVM runtime name of the egress-guard compatible variant (defaults to {@link GVISOR_SANDBOX_KVM_SHARED_NETNS_RUNTIME_NAME}). */
  kvmSharedNetnsRuntimeName?: string;
}

const RELEASE_PATTERN = /^[0-9]{8}(\.[0-9]+)?$/;
const RUNTIME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
const SHA512_PATTERN = /^[a-f0-9]{128}$/;
const IMAGE_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._/:@-]{0,254}$/;

interface ResolvedOptions {
  release: string;
  sha512X86: string;
  sha512Arm: string;
  runtimeName: string;
  sharedNetnsRuntimeName: string;
  verifyImage: string;
  kvm: boolean;
  kvmApt: boolean;
  kvmRuntimeName: string;
  kvmSharedNetnsRuntimeName: string;
}

function resolveOptions(options: GvisorInstallScriptOptions = {}): ResolvedOptions {
  const release = options.release?.trim() || GVISOR_DEFAULT_RELEASE;
  const runtimeName = options.runtimeName?.trim() || GVISOR_SANDBOX_RUNTIME_NAME;
  const sharedNetnsRuntimeName = options.sharedNetnsRuntimeName?.trim() || GVISOR_SANDBOX_SHARED_NETNS_RUNTIME_NAME;
  const verifyImage = options.verifyImage?.trim() || 'hello-world';
  const kvm = options.kvm !== false;
  const kvmApt = options.kvmApt !== false;
  const kvmRuntimeName = options.kvmRuntimeName?.trim() || GVISOR_SANDBOX_KVM_RUNTIME_NAME;
  const kvmSharedNetnsRuntimeName =
    options.kvmSharedNetnsRuntimeName?.trim() || GVISOR_SANDBOX_KVM_SHARED_NETNS_RUNTIME_NAME;

  if (!RELEASE_PATTERN.test(release)) {
    throw new Error(`Invalid gVisor release '${release}' (expected e.g. ${GVISOR_DEFAULT_RELEASE})`);
  }

  const runtimeNames = [runtimeName, sharedNetnsRuntimeName, kvmRuntimeName, kvmSharedNetnsRuntimeName];

  for (const name of runtimeNames) {
    if (!RUNTIME_PATTERN.test(name)) {
      throw new Error(`Invalid Docker runtime name '${name}'`);
    }
  }

  if (runtimeName === sharedNetnsRuntimeName) {
    throw new Error('The shared network namespace runtime must differ from the sandbox runtime');
  }

  if (new Set(runtimeNames).size !== runtimeNames.length) {
    throw new Error('The KVM runtimes must differ from each other and from the systrap runtimes');
  }

  if (!IMAGE_PATTERN.test(verifyImage)) {
    throw new Error(`Invalid verification image '${verifyImage}'`);
  }

  const pinned = release === GVISOR_DEFAULT_RELEASE ? GVISOR_DEFAULT_RELEASE_SHA512 : { x86_64: '', aarch64: '' };
  const sha512X86 = (options.sha512?.x86_64 ?? pinned.x86_64).trim().toLowerCase();
  const sha512Arm = (options.sha512?.aarch64 ?? pinned.aarch64).trim().toLowerCase();

  for (const hash of [sha512X86, sha512Arm]) {
    if (hash && !SHA512_PATTERN.test(hash)) {
      throw new Error('Invalid gVisor SHA-512 checksum');
    }
  }

  return {
    release,
    sha512X86,
    sha512Arm,
    runtimeName,
    sharedNetnsRuntimeName,
    verifyImage,
    kvm,
    kvmApt,
    kvmRuntimeName,
    kvmSharedNetnsRuntimeName,
  };
}

/**
 * Bash function definitions shared by the cloud-init block and the standalone script.
 * Uses only `$VAR` expansions (no brace expansions) so it can live in TypeScript template literals.
 * `restartAllowed`: whether Docker may be restarted when a reload fails (fresh cloud-init hosts only;
 * on a running host a restart would stop every environment).
 */
function buildFunctions(o: ResolvedOptions, restartAllowed: boolean): string {
  return `AGENSTRA_GVISOR_RELEASE="$(printf '%s' "\${GVISOR_RELEASE:-${o.release}}")"
AGENSTRA_GVISOR_RUNTIME="${o.runtimeName}"
AGENSTRA_GVISOR_HOSTNET_RUNTIME="${o.sharedNetnsRuntimeName}"
AGENSTRA_GVISOR_KVM_RUNTIME="${o.kvmRuntimeName}"
AGENSTRA_GVISOR_KVM_HOSTNET_RUNTIME="${o.kvmSharedNetnsRuntimeName}"
AGENSTRA_GVISOR_KVM_ENABLED="$(printf '%s' "\${GVISOR_KVM:-${o.kvm ? '1' : '0'}}")"
AGENSTRA_KVM_APT_ENABLED="$(printf '%s' "\${AGENSTRA_KVM_APT:-${o.kvmApt ? '1' : '0'}}")"
AGENSTRA_GVISOR_VERIFY_IMAGE="${o.verifyImage}"
AGENSTRA_GVISOR_PINNED_RELEASE="${o.release}"
AGENSTRA_GVISOR_SHA512_X86_64="${o.sha512X86}"
AGENSTRA_GVISOR_SHA512_AARCH64="${o.sha512Arm}"
AGENSTRA_GVISOR_PREFIX="/usr/local/lib/agenstra-gvisor"
AGENSTRA_GVISOR_PREVIOUS=""
AGENSTRA_GVISOR_NEW_TARGET=""
AGENSTRA_DOCKER_DAEMON_JSON="/etc/docker/daemon.json"
AGENSTRA_DOCKER_DAEMON_BACKUP="/etc/docker/daemon.json.agenstra-gvisor.bak"
AGENSTRA_DOCKER_DAEMON_KVM_BACKUP="/etc/docker/daemon.json.agenstra-gvisor-kvm.bak"
AGENSTRA_KVM_DEVICE_PATH="/dev/kvm"
AGENSTRA_KVM_CPUINFO="/proc/cpuinfo"
AGENSTRA_KVM_PROC_MODULES="/proc/modules"
AGENSTRA_KVM_SYSFS_MODULES="/sys/module"
AGENSTRA_KVM_MODULES_LOAD_DIR="/etc/modules-load.d"
AGENSTRA_DOCKER_RESTART_ALLOWED="${restartAllowed ? '1' : '0'}"

agenstra_gvisor_log() { echo "[agenstra-gvisor] $*" >&2; }

agenstra_gvisor_arch() {
  case "$(uname -m)" in
    x86_64|amd64) echo x86_64 ;;
    aarch64|arm64) echo aarch64 ;;
    *) echo unsupported ;;
  esac
}

# gVisor requires Linux 5.6+ (the systrap platform needs no KVM; the KVM platform is prepared separately).
agenstra_gvisor_kernel_supported() {
  local major minor
  major="$(uname -r | cut -d. -f1)"
  minor="$(uname -r | cut -d. -f2 | sed 's/[^0-9].*//')"
  [ -n "$major" ] && [ -n "$minor" ] || return 1
  [ "$major" -gt 5 ] || { [ "$major" -eq 5 ] && [ "$minor" -ge 6 ]; }
}

agenstra_docker_ready() { docker info >/dev/null 2>&1; }

# Install a package on apt systems; waits for the dpkg lock (first-boot upgrades) and refreshes the
# package index once when the package is unknown.
agenstra_apt_install() {
  local apt_opts="-y -q -o DPkg::Lock::Timeout=180"
  # shellcheck disable=SC2086
  DEBIAN_FRONTEND=noninteractive apt-get install $apt_opts "$@" >/dev/null 2>&1 && return 0
  apt-get update -q -o DPkg::Lock::Timeout=180 >/dev/null 2>&1 || return 1
  # shellcheck disable=SC2086
  DEBIAN_FRONTEND=noninteractive apt-get install $apt_opts "$@" >/dev/null 2>&1
}

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

# agenstra_runtimes_registered all|any NAME...: whether all / any of the Docker runtimes are registered.
agenstra_runtimes_registered() {
  local mode="$1" runtimes name found=0
  shift
  runtimes="$(docker info --format '{{json .Runtimes}}' 2>/dev/null)" || return 1
  for name in "$@"; do
    if printf '%s' "$runtimes" | grep -qF "\\"$name\\""; then found=$((found + 1)); fi
  done
  if [ "$mode" = "all" ]; then [ "$found" -eq "$#" ]; else [ "$found" -gt 0 ]; fi
}

agenstra_gvisor_runtime_registered() {
  agenstra_runtimes_registered all "$AGENSTRA_GVISOR_RUNTIME" "$AGENSTRA_GVISOR_HOSTNET_RUNTIME"
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
    expected="$(printf '%s' "\${GVISOR_SHA512:-}" | tr 'A-F' 'a-f')"
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
    # The release archive is bzip2 compressed; minimal cloud images ship without bzip2.
    if ! command -v bzip2 >/dev/null 2>&1 && command -v apt-get >/dev/null 2>&1; then
      agenstra_apt_install bzip2 || true
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

# KVM facts (no changes): cpu=yes|no|unknown (vmx/svm flag; unknown on aarch64), device=present|absent,
# module=loaded|absent, nested=yes|no|unknown, hypervisor=yes|no (the host itself is a VM).
agenstra_kvm_facts() {
  local cpu=unknown device=absent module=absent nested=unknown hypervisor=no param
  if [ "$(agenstra_gvisor_arch)" = "x86_64" ]; then
    if grep -Eqw 'vmx|svm' "$AGENSTRA_KVM_CPUINFO" 2>/dev/null; then cpu=yes; else cpu=no; fi
    grep -qw hypervisor "$AGENSTRA_KVM_CPUINFO" 2>/dev/null && hypervisor=yes
  fi
  [ -c "$AGENSTRA_KVM_DEVICE_PATH" ] && device=present
  grep -Eq '^kvm(_intel|_amd)? ' "$AGENSTRA_KVM_PROC_MODULES" 2>/dev/null && module=loaded
  for param in "$AGENSTRA_KVM_SYSFS_MODULES/kvm_intel/parameters/nested" "$AGENSTRA_KVM_SYSFS_MODULES/kvm_amd/parameters/nested"; do
    if [ -r "$param" ]; then
      case "$(cat "$param" 2>/dev/null)" in Y|y|1) nested=yes ;; *) nested=no ;; esac
    fi
  done
  AGENSTRA_KVM_CPU="$cpu"
  AGENSTRA_KVM_DEVICE="$device"
  AGENSTRA_KVM_MODULE="$module"
  AGENSTRA_KVM_NESTED="$nested"
  AGENSTRA_KVM_HYPERVISOR="$hypervisor"
}

agenstra_kvm_wait_device() {
  local i
  command -v udevadm >/dev/null 2>&1 && udevadm settle >/dev/null 2>&1
  for i in 1 2 3 4 5 6 7 8 9 10; do
    [ -c "$AGENSTRA_KVM_DEVICE_PATH" ] && return 0
    sleep 1
  done
  return 1
}

# Make /dev/kvm available when the CPU supports hardware virtualization: load (and persist) the KVM
# modules; install the distribution's extra kernel modules only when the module does not exist. No
# hypervisor stack (libvirt / QEMU) is installed: gVisor's KVM platform only needs /dev/kvm, and the
# microvm level ships its hypervisor in its container image.
agenstra_kvm_prepare() {
  local vendor=""
  agenstra_kvm_facts
  [ "$AGENSTRA_KVM_DEVICE" = "present" ] && return 0
  if [ "$AGENSTRA_KVM_CPU" = "no" ]; then
    agenstra_gvisor_log "No hardware virtualization (vmx/svm) exposed to this host; KVM is unavailable"
    return 1
  fi
  if [ "$(agenstra_gvisor_arch)" = "x86_64" ]; then
    if grep -qw vmx "$AGENSTRA_KVM_CPUINFO" 2>/dev/null; then vendor=kvm_intel; else vendor=kvm_amd; fi
  fi
  command -v modprobe >/dev/null 2>&1 || return 1
  if ! modprobe kvm >/dev/null 2>&1 || { [ -n "$vendor" ] && ! modprobe "$vendor" >/dev/null 2>&1; }; then
    # Modules that exist but fail to load (e.g. virtualization disabled) are not fixed by a package.
    # AGENSTRA_KVM_APT=0: the host's packages come from a pinned snapshot; nothing is installed here.
    if [ "$AGENSTRA_KVM_APT_ENABLED" = "1" ] && command -v apt-get >/dev/null 2>&1 && ! modinfo "\${vendor:-kvm}" >/dev/null 2>&1; then
      agenstra_gvisor_log "Installing the KVM kernel modules (linux-modules-extra-$(uname -r))"
      agenstra_apt_install "linux-modules-extra-$(uname -r)" || true
    fi
    modprobe kvm >/dev/null 2>&1 || return 1
    if [ -n "$vendor" ]; then modprobe "$vendor" >/dev/null 2>&1 || return 1; fi
  fi
  if [ -d "$AGENSTRA_KVM_MODULES_LOAD_DIR" ]; then
    printf 'kvm\\n%s\\n' "$vendor" | sed '/^$/d' >"$AGENSTRA_KVM_MODULES_LOAD_DIR/agenstra-kvm.conf"
  fi
  agenstra_kvm_wait_device
}

# Host KVM preparation, independent of gVisor (sandboxed-kvm needs gVisor, microvm only /dev/kvm). It runs
# before the gVisor installation so a gVisor failure or GVISOR_KVM=0 never withholds /dev/kvm from the microvm
# level. AGENSTRA_KVM=0 skips it. Never fatal.
agenstra_kvm_prepare_host() {
  if [ "\${AGENSTRA_KVM:-1}" = "0" ]; then
    agenstra_gvisor_log "KVM preparation disabled (AGENSTRA_KVM=0); skipping"
    return 1
  fi
  if agenstra_kvm_prepare; then
    agenstra_gvisor_log "KVM is available (/dev/kvm)"
    return 0
  fi
  agenstra_gvisor_log "KVM is not available on this host; the sandboxed-kvm and microvm levels stay unavailable"
  return 1
}

# Either KVM runtime registered (partial registrations are cleaned up as well).
agenstra_kvm_any_runtime_registered() {
  agenstra_runtimes_registered any "$AGENSTRA_GVISOR_KVM_RUNTIME" "$AGENSTRA_GVISOR_KVM_HOSTNET_RUNTIME"
}

agenstra_kvm_runtime_registered() {
  agenstra_runtimes_registered all "$AGENSTRA_GVISOR_KVM_RUNTIME" "$AGENSTRA_GVISOR_KVM_HOSTNET_RUNTIME"
}

agenstra_kvm_verify() {
  agenstra_kvm_runtime_registered || return 1
  if ! docker image inspect "$AGENSTRA_GVISOR_VERIFY_IMAGE" >/dev/null 2>&1; then
    agenstra_gvisor_log "Smoke test image unavailable; skipping KVM container smoke test"
    return 0
  fi
  docker run --rm --runtime="$AGENSTRA_GVISOR_KVM_RUNTIME" --network=none "$AGENSTRA_GVISOR_VERIFY_IMAGE" >/dev/null 2>&1 || return 1
  docker run --rm --runtime="$AGENSTRA_GVISOR_KVM_HOSTNET_RUNTIME" --network=none "$AGENSTRA_GVISOR_VERIFY_IMAGE" >/dev/null 2>&1
}

agenstra_kvm_unregister() {
  local runsc="$1"
  [ -x "$runsc" ] || return 0
  "$runsc" uninstall --runtime="$AGENSTRA_GVISOR_KVM_RUNTIME" >/dev/null 2>&1 || true
  "$runsc" uninstall --runtime="$AGENSTRA_GVISOR_KVM_HOSTNET_RUNTIME" >/dev/null 2>&1 || true
}

# Only the KVM runtime entries are rolled back; the systrap runtimes and runc stay untouched.
agenstra_kvm_rollback() {
  agenstra_gvisor_log "Rolling back the gVisor KVM runtime registration"
  if [ -f "$AGENSTRA_DOCKER_DAEMON_KVM_BACKUP" ]; then
    cp -p "$AGENSTRA_DOCKER_DAEMON_KVM_BACKUP" "$AGENSTRA_DOCKER_DAEMON_JSON"
    rm -f "$AGENSTRA_DOCKER_DAEMON_KVM_BACKUP"
  else
    agenstra_kvm_unregister "$AGENSTRA_GVISOR_PREFIX/current/runsc"
  fi
  agenstra_docker_reload || agenstra_gvisor_log "WARNING: Docker reload after KVM rollback failed"
}

# Register the sandboxed-kvm runtimes (gVisor KVM platform) on top of an installed gVisor release.
# Returns 0 when they are ready, 1 when KVM is unavailable, disabled or the registration was rolled back.
agenstra_kvm_install() {
  local runsc="$AGENSTRA_GVISOR_PREFIX/current/runsc"
  [ -x "$runsc" ] || { agenstra_gvisor_log "gVisor is not installed; skipping the KVM platform"; return 1; }
  if [ "$AGENSTRA_GVISOR_KVM_ENABLED" != "1" ]; then
    agenstra_gvisor_log "KVM platform disabled (GVISOR_KVM=0); skipping"
    if agenstra_kvm_any_runtime_registered; then
      agenstra_kvm_unregister "$runsc"
      agenstra_docker_reload || true
    fi
    return 1
  fi
  if ! { [ -c "$AGENSTRA_KVM_DEVICE_PATH" ] || agenstra_kvm_prepare_host; }; then
    agenstra_gvisor_log "KVM is not available on this host; the sandboxed-kvm level stays unavailable"
    if agenstra_kvm_any_runtime_registered; then
      agenstra_kvm_unregister "$runsc"
      agenstra_docker_reload || true
    fi
    return 1
  fi
  if [ -f "$AGENSTRA_DOCKER_DAEMON_JSON" ]; then
    cp -p "$AGENSTRA_DOCKER_DAEMON_JSON" "$AGENSTRA_DOCKER_DAEMON_KVM_BACKUP"
  else
    rm -f "$AGENSTRA_DOCKER_DAEMON_KVM_BACKUP"
  fi
  if ! "$runsc" install --runtime="$AGENSTRA_GVISOR_KVM_RUNTIME" -- --platform=kvm >/dev/null 2>&1 ||
    ! "$runsc" install --runtime="$AGENSTRA_GVISOR_KVM_HOSTNET_RUNTIME" -- --platform=kvm --network=host >/dev/null 2>&1; then
    agenstra_gvisor_log "KVM runtime registration failed"
    agenstra_kvm_rollback
    return 1
  fi
  if ! agenstra_docker_reload || ! agenstra_kvm_verify; then
    agenstra_gvisor_log "gVisor KVM verification failed"
    agenstra_kvm_rollback
    return 1
  fi
  rm -f "$AGENSTRA_DOCKER_DAEMON_KVM_BACKUP"
  agenstra_gvisor_log "gVisor KVM runtimes '$AGENSTRA_GVISOR_KVM_RUNTIME' and '$AGENSTRA_GVISOR_KVM_HOSTNET_RUNTIME' are ready"
  return 0
}`;
}

/**
 * Drop comment-only lines and indentation (cloud-init user data is size limited, e.g. 32 KiB on
 * Hetzner Cloud). Only for generated function bodies: they contain no heredocs or multi-line strings.
 */
function compactBash(script: string): string {
  return script
    .split('\n')
    .map((line) => line.trimStart())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .join('\n');
}

/**
 * Bash block for cloud-init user data, inserted right after Docker is installed and verified.
 * Never aborts the surrounding script (it may run with `set -euo pipefail`).
 */
export function buildGvisorInstallScript(options: GvisorInstallScriptOptions = {}): string {
  const o = resolveOptions(options);

  return `# Container isolation: prepare KVM (/dev/kvm, also for the microvm level), install gVisor (sandboxed level)
# and, when the host supports KVM, the gVisor KVM runtimes (sandboxed-kvm level). Optional and never fatal: on
# any failure the runtime registration is rolled back and the host keeps running environments with runc.
agenstra_prepare_gvisor() {
set +e
${compactBash(buildFunctions(o, true))}
agenstra_kvm_prepare_host || true
agenstra_gvisor_install || return 1
if agenstra_kvm_install; then
    echo "gVisor KVM runtimes installed"
else
    echo "gVisor KVM runtimes not installed; the sandboxed-kvm level stays unavailable"
fi
return 0
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
`;
}

/**
 * Standalone, idempotent host script (`check | install | uninstall`, `--json`) for self-hosted
 * agent manager hosts. Kept in the repository at `apps/agenstra/backend-agent-manager/host/agenstra-gvisor.sh`.
 */
export function buildGvisorHostScript(options: GvisorInstallScriptOptions = {}): string {
  const o = resolveOptions(options);
  const codes = GVISOR_HOST_SCRIPT_EXIT_CODES;

  return `#!/usr/bin/env bash
# Agenstra container isolation host preparation (gVisor / runsc, systrap and KVM platforms).
#
# GENERATED from libs/domains/shared/backend/util-container-runtime (buildGvisorHostScript) - do not edit.
#
# Usage: agenstra-gvisor.sh check|install|uninstall|install-kvm|uninstall-kvm [--json]
#   check      Report Docker/runc baseline and gVisor runtime state (no changes).
#   install    Install the pinned, checksum-verified gVisor release and register the Docker runtimes
#              '${o.runtimeName}' (--platform=systrap) and '${o.sharedNetnsRuntimeName}' (--platform=systrap
#              --network=host, for workers behind an egress guard). Docker's default runtime stays runc.
#              When the CPU supports hardware virtualization, the KVM modules are loaded (and persisted)
#              and '${o.kvmRuntimeName}' (--platform=kvm) and '${o.kvmSharedNetnsRuntimeName}' (--platform=kvm
#              --network=host) are registered as well (sandboxed-kvm level; no libvirt / QEMU needed).
#              Docker is only reloaded (never restarted). Rolled back on failure (a KVM failure only
#              rolls back the KVM runtimes).
#   uninstall  Remove the runtime registrations (installed binaries stay under /usr/local/lib/agenstra-gvisor,
#              the persisted KVM modules stay for the microvm level).
#   install-kvm    Prepare KVM and register only the KVM runtimes on top of the installed gVisor release (no
#                  download; GVISOR_KVM=0 / AGENSTRA_KVM=0 still apply).
#   uninstall-kvm  Remove only the KVM runtime registrations (systrap runtimes, runc and the modules stay).
# Environment: GVISOR_RELEASE (default ${o.release}), GVISOR_SHA512 (required for non-default releases),
#              GVISOR_KVM=0 skips the gVisor KVM runtimes, AGENSTRA_KVM=0 skips the host KVM preparation
#              (which otherwise runs first and independently of gVisor; the microvm level needs /dev/kvm only),
#              AGENSTRA_KVM_APT=0 never installs the extra kernel modules package.
#
# Exit codes: 0 ok, ${codes.USAGE} usage, ${codes.NOT_ROOT} not root, ${codes.DOCKER_BASELINE_UNAVAILABLE} Docker/runc baseline unavailable (E_DOCKER_BASELINE_UNAVAILABLE),
#             ${codes.GVISOR_UNSUPPORTED_HOST} unsupported host, ${codes.GVISOR_INSTALL_FAILED} install failed (rolled back), ${codes.GVISOR_VERIFY_FAILED} runtime not ready.
#             Exit codes only reflect the systrap runtimes; the KVM state is reported in the output.
# After changes, restart the agent manager or call POST /api/isolation/probe so it re-probes the host.
set -uo pipefail

${buildFunctions(o, false)}

agenstra_gvisor_report() {
  local baseline="$1" sandboxed="$2" json="$3" sandboxed_kvm="\${4:-unsupported}"
  agenstra_kvm_facts
  if [ "$json" = "1" ]; then
    printf '{"runtime":"%s","sharedNetnsRuntime":"%s","release":"%s","standard":"%s","sandboxed":"%s","kvmRuntime":"%s","kvmSharedNetnsRuntime":"%s","sandboxedKvm":"%s","kvm":{"cpu":"%s","device":"%s","module":"%s","nested":"%s","hypervisor":"%s"}}\\n' "$AGENSTRA_GVISOR_RUNTIME" "$AGENSTRA_GVISOR_HOSTNET_RUNTIME" "$AGENSTRA_GVISOR_RELEASE" "$baseline" "$sandboxed" "$AGENSTRA_GVISOR_KVM_RUNTIME" "$AGENSTRA_GVISOR_KVM_HOSTNET_RUNTIME" "$sandboxed_kvm" "$AGENSTRA_KVM_CPU" "$AGENSTRA_KVM_DEVICE" "$AGENSTRA_KVM_MODULE" "$AGENSTRA_KVM_NESTED" "$AGENSTRA_KVM_HYPERVISOR"
  else
    echo "Standard (runc): $baseline"
    echo "Sandboxed ($AGENSTRA_GVISOR_RUNTIME, $AGENSTRA_GVISOR_HOSTNET_RUNTIME): $sandboxed"
    echo "Sandboxed KVM ($AGENSTRA_GVISOR_KVM_RUNTIME, $AGENSTRA_GVISOR_KVM_HOSTNET_RUNTIME): $sandboxed_kvm"
    echo "KVM: cpu=$AGENSTRA_KVM_CPU device=$AGENSTRA_KVM_DEVICE module=$AGENSTRA_KVM_MODULE nested=$AGENSTRA_KVM_NESTED hypervisor=$AGENSTRA_KVM_HYPERVISOR"
  fi
}

# sandboxed-kvm state for reports: registered, unsupported (no /dev/kvm) or not-registered.
agenstra_kvm_state() {
  if agenstra_kvm_runtime_registered; then echo registered; elif [ -c "$AGENSTRA_KVM_DEVICE_PATH" ]; then echo not-registered; else echo unsupported; fi
}

main() {
  local command="\${1:-}" json=0 baseline=unavailable sandboxed=unsupported sandboxed_kvm=unsupported
  [ "\${2:-}" = "--json" ] && json=1
  case "$command" in
    check|install|uninstall|install-kvm|uninstall-kvm) ;;
    *) echo "Usage: $0 check|install|uninstall|install-kvm|uninstall-kvm [--json]" >&2; return ${codes.USAGE} ;;
  esac
  if [ "$(id -u)" -ne 0 ] && [ "$command" != "check" ]; then
    echo "This command must run as root" >&2; return ${codes.NOT_ROOT}
  fi
  if ! agenstra_docker_ready; then
    agenstra_gvisor_report "$baseline" "$sandboxed" "$json"
    return ${codes.DOCKER_BASELINE_UNAVAILABLE}
  fi
  baseline=ready
  case "$command" in
    check)
      if agenstra_gvisor_runtime_registered; then sandboxed=registered; fi
      agenstra_gvisor_report "$baseline" "$sandboxed" "$json" "$(agenstra_kvm_state)"
      [ "$sandboxed" = "registered" ] && return 0 || return ${codes.GVISOR_VERIFY_FAILED}
      ;;
    install)
      # /dev/kvm first: the microvm level needs it even where gVisor cannot be installed.
      agenstra_kvm_prepare_host || true
      if [ "$(agenstra_gvisor_arch)" = "unsupported" ] || ! agenstra_gvisor_kernel_supported; then
        agenstra_gvisor_report "$baseline" unsupported "$json"; return ${codes.GVISOR_UNSUPPORTED_HOST}
      fi
      if agenstra_gvisor_install; then
        if agenstra_kvm_install; then sandboxed_kvm=ready; else sandboxed_kvm="$(agenstra_kvm_state)"; fi
        agenstra_gvisor_report "$baseline" ready "$json" "$sandboxed_kvm"; return 0
      fi
      agenstra_docker_ready || { agenstra_gvisor_report unavailable install-failed "$json"; return ${codes.DOCKER_BASELINE_UNAVAILABLE}; }
      agenstra_gvisor_report "$baseline" install-failed "$json"; return ${codes.GVISOR_INSTALL_FAILED}
      ;;
    uninstall)
      # Only the runtime entries are removed; other daemon.json changes made since the install are kept.
      agenstra_gvisor_unregister "$AGENSTRA_GVISOR_PREFIX/current/runsc"
      agenstra_kvm_unregister "$AGENSTRA_GVISOR_PREFIX/current/runsc"
      agenstra_docker_reload || true
      # The persisted KVM modules stay: the microvm level needs /dev/kvm without gVisor.
      rm -f "$AGENSTRA_DOCKER_DAEMON_KVM_BACKUP" "$AGENSTRA_DOCKER_DAEMON_BACKUP"
      agenstra_docker_ready || { agenstra_gvisor_report unavailable unsupported "$json"; return ${codes.DOCKER_BASELINE_UNAVAILABLE}; }
      agenstra_gvisor_report "$baseline" unsupported "$json"; return 0
      ;;
    install-kvm)
      # Only the KVM part, on top of the installed release: nothing is downloaded, the systrap runtimes stay.
      agenstra_gvisor_runtime_registered && sandboxed=registered
      agenstra_kvm_prepare_host || true
      if agenstra_kvm_install; then sandboxed_kvm=ready; else sandboxed_kvm="$(agenstra_kvm_state)"; fi
      agenstra_gvisor_report "$baseline" "$sandboxed" "$json" "$sandboxed_kvm"; return 0
      ;;
    uninstall-kvm)
      # Only the KVM runtime entries (a node opted out of KVM); systrap, runc and the persisted modules stay.
      agenstra_gvisor_runtime_registered && sandboxed=registered
      if agenstra_kvm_any_runtime_registered; then
        agenstra_kvm_unregister "$AGENSTRA_GVISOR_PREFIX/current/runsc"
        agenstra_docker_reload || true
      fi
      rm -f "$AGENSTRA_DOCKER_DAEMON_KVM_BACKUP"
      agenstra_gvisor_report "$baseline" "$sandboxed" "$json" "$(agenstra_kvm_state)"; return 0
      ;;
  esac
}

main "$@"
`;
}
