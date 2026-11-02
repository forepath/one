# Shared helpers of the generic launcher scripts (launch-generic, launch-vm, vm-ctl, vm-console); sourced, never run.
# Agenstra's bundled `launch` keeps its own copy of these definitions (byte-identical to the Agenstra image).
#
# Names stay Agenstra's (/usr/lib/agenstra-microvm, agenstra-vmm, uid 10930): the launcher is shared, a rename
# would change the bridge contract (MICROVM_* constants in @forepath/shared/backend/util-microvm-bridge).
# shellcheck shell=bash

export PATH=/usr/sbin:/usr/bin:/sbin:/bin

readonly INSTALL_DIR=/usr/lib/agenstra-microvm
readonly RUN_DIR=/dev/shm/agenstra-microvm
readonly VMM_DIR="${RUN_DIR}/vmm"
readonly FS_DIR="${RUN_DIR}/fs"
readonly VMM_USER=agenstra-vmm
readonly LAUNCHER_OVERHEAD_MB=384
readonly EXIT_LAUNCH_FAILED=125
# Per-replica configuration from the node agent (bind mount, read-only except stats/).
readonly CONFIG_DIR=/run/loadweaver/vm

log() { printf 'agenstra-microvm: %s\n' "$*" >&2; }
die() {
  log "$*"
  exit "${EXIT_LAUNCH_FAILED}"
}

vmm_uid=$(id -u "${VMM_USER}")
vmm_gid=$(id -g "${VMM_USER}")
# Supplementary groups of the VMM (kvm, block devices); extended by the launchers before the VMM starts.
vmm_groups=""

add_vmm_group() {
  case ",${vmm_groups}," in
    *",$1,"*) ;;
    *) vmm_groups="${vmm_groups:+${vmm_groups},}$1" ;;
  esac
}

as_vmm() {
  setpriv --reuid="${vmm_uid}" --regid="${vmm_gid}" --groups="${vmm_groups:-${vmm_gid}}" --inh-caps=-all \
    --bounding-set=-all -- \
    env HOME="${VMM_DIR}" XDG_RUNTIME_DIR="${VMM_DIR}/run" XDG_CONFIG_HOME="${VMM_DIR}/config" \
    XDG_CACHE_HOME="${VMM_DIR}/cache" XDG_DATA_HOME="${VMM_DIR}/data" "$@"
}

# Background jobs: `as_vmm_exec <command> &` — the job's subshell becomes the command (exec), so `$!` is the command's
# pid and the launcher's TERM reaches it. With `as_vmm <command> &` `$!` is a subshell that dies on TERM without passing
# it on: the daemon never stopped the workload gracefully and the launcher exited 143 (combined gate G3).
as_vmm_exec() {
  exec setpriv --reuid="${vmm_uid}" --regid="${vmm_gid}" --groups="${vmm_groups:-${vmm_gid}}" --inh-caps=-all \
    --bounding-set=-all -- \
    env HOME="${VMM_DIR}" XDG_RUNTIME_DIR="${VMM_DIR}/run" XDG_CONFIG_HOME="${VMM_DIR}/config" \
    XDG_CACHE_HOME="${VMM_DIR}/cache" XDG_DATA_HOME="${VMM_DIR}/data" "$@"
}

virsh_vmm() { as_vmm virsh -q -c qemu:///session "$@"; }

require_root_and_kvm() {
  [ "$(id -u)" = 0 ] || die "the launcher must start as root inside the container (do not set a container user)"
  [ -c /dev/kvm ] || die "E_KVM_UNAVAILABLE: /dev/kvm is not available in the container"
  [ -r /dev/kvm ] && [ -w /dev/kvm ] || die "E_KVM_UNAVAILABLE: /dev/kvm is not accessible"
  add_vmm_group "$(stat -c %g /dev/kvm)"
}

prepare_run_dir() {
  rm -rf "${RUN_DIR}"
  install -d -m 0755 -o root -g root "${RUN_DIR}"
  install -d -m 0750 -o root -g "${vmm_gid}" "${FS_DIR}"
  install -d -m 0700 -o "${vmm_uid}" -g "${vmm_gid}" "${VMM_DIR}" "${VMM_DIR}/run"
}

# Waits until the node agent created the tap device(s) in this network namespace (after container start).
wait_for_taps() {
  local tap deadline=$((SECONDS + 30))

  for tap in "$@"; do
    [[ "${tap}" =~ ^lwtap[0-9]{1,2}$ ]] || die "invalid tap name ${tap}"
    until [ -e "/sys/class/net/${tap}" ]; do
      [ "${SECONDS}" -lt "${deadline}" ] || die "E_MICROVM_NET: tap ${tap} was not created within 30 s"
      sleep 0.2
    done
  done
}

# Guest vCPUs: explicit, else the container's CPU quota, else all host CPUs (never more than the host has).
guest_vcpus() {
  local vcpus="${AGENSTRA_MICROVM_VCPUS:-}" host_cpus quota period

  host_cpus=$(nproc --all)
  if [ -z "${vcpus}" ]; then
    read -r quota period </sys/fs/cgroup/cpu.max 2>/dev/null || quota=max
    if [ "${quota:-max}" != max ] && [ "${period:-0}" -gt 0 ]; then
      vcpus=$(((quota + period - 1) / period))
    else
      vcpus="${host_cpus}"
    fi
  fi
  [[ "${vcpus}" =~ ^[0-9]+$ ]] && [ "${vcpus}" -ge 1 ] || die "invalid vCPU count ${vcpus}"
  [ "${vcpus}" -le "${host_cpus}" ] || vcpus="${host_cpus}"
  printf '%s\n' "${vcpus}"
}

# Guest memory (MiB): explicit, else the container's memory limit minus the launcher overhead.
guest_memory_mb() {
  local memory_mb="${AGENSTRA_MICROVM_MEMORY_MB:-}" limit

  if [ -z "${memory_mb}" ]; then
    limit=$(cat /sys/fs/cgroup/memory.max 2>/dev/null || echo max)
    if [ "${limit}" != max ]; then
      memory_mb=$((limit / 1048576 - LAUNCHER_OVERHEAD_MB))
    else
      memory_mb=2048
    fi
  fi
  [[ "${memory_mb}" =~ ^[0-9]+$ ]] && [ "${memory_mb}" -ge 128 ] ||
    die "not enough memory for the microVM (${memory_mb} MiB)"
  printf '%s\n' "${memory_mb}"
}

guest_arch() {
  case "$(uname -m)" in
    x86_64) printf 'x86_64 q35 ttyS0\n' ;;
    aarch64) printf 'aarch64 virt ttyAMA0\n' ;;
    *) die "unsupported architecture $(uname -m)" ;;
  esac
}

# The domain name a launcher started (vm-ctl / vm-console act on it).
domain_name() {
  local name

  name=$(cat "${VMM_DIR}/domain.name" 2>/dev/null || true)
  [[ "${name}" =~ ^[a-z][a-z0-9-]{0,31}$ ]] || die "no microVM is running in this container"
  printf '%s\n' "${name}"
}
