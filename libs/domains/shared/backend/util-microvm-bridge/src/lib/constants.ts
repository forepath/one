/**
 * Shared constants of the microVM bridge (launcher <-> guest agent over virtio-serial, exec client <-> launcher
 * daemon over a UNIX socket). The protocol version is published as the image label
 * `io.agenstra.microvm.protocol`; the agent manager only treats images with a matching label as microVM-capable.
 */
export const MICROVM_BRIDGE_PROTOCOL_VERSION = 1;

/** Image label that marks a worker image as microVM-capable (value: the bridge protocol version). */
export const MICROVM_PROTOCOL_LABEL = 'io.agenstra.microvm.protocol';

/** Install prefix of the microVM tooling inside the microVM worker image. */
export const MICROVM_INSTALL_DIR = '/usr/lib/agenstra-microvm';

/** Exec client the agent manager runs through `docker exec` for microVM workers. */
export const MICROVM_EXEC_CLIENT_PATH = `${MICROVM_INSTALL_DIR}/vm-exec`;

/** Unprivileged launcher user that owns the VMM, the bridge daemon and the exec socket. Never the guard-exempt uid. */
export const MICROVM_VMM_USER = 'agenstra-vmm';
export const MICROVM_VMM_UID = 10930;

/** Launcher runtime directory (container tmpfs below `/dev`, never shared with the guest). */
export const MICROVM_RUNTIME_DIR = '/dev/shm/agenstra-microvm';

/** Exec socket of the launcher daemon (owned by the VMM user, mode 0600). */
export const MICROVM_EXEC_SOCKET = `${MICROVM_RUNTIME_DIR}/vmm/exec.sock`;

/** Launcher configuration variables; they are stripped from the environment handed to the guest. */
export const MICROVM_INTERNAL_ENV_PREFIX = 'AGENSTRA_MICROVM_';

/** virtio-serial channel name of the bridge (guest: `/sys/class/virtio-ports/<port>/name`). */
export const MICROVM_BRIDGE_CHANNEL = 'io.agenstra.bridge';

/** Upper bound of a single frame payload. Larger data is split into several DATA frames. */
export const MICROVM_MAX_FRAME_PAYLOAD = 64 * 1024;

/** Per-stream, per-direction flow-control window (bytes in flight before the receiver grants more). */
export const MICROVM_STREAM_WINDOW = 256 * 1024;

/**
 * Upper bound of a reassembled control message (OPEN_EXEC carries argv + env, BOOT the workload environment; the
 * managed environment file alone may hold 4 MiB). Larger messages are a protocol error.
 */
export const MICROVM_MAX_CONTROL_PAYLOAD = 8 * 1024 * 1024;

/** Guest address plan of the user-mode network (QEMU libslirp defaults). */
export const MICROVM_GUEST_ADDRESS = '10.0.2.15';
export const MICROVM_GUEST_GATEWAY = '10.0.2.2';
export const MICROVM_GUEST_DNS = '10.0.2.3';

/** Exit status used when the bridge itself fails (mirrors `docker exec` runtime failures). */
export const MICROVM_EXEC_BRIDGE_FAILURE_EXIT_CODE = 125;

/**
 * Neutral aliases (the launcher is shared by Agenstra and Loadweaver). The values keep Agenstra's names so existing
 * worker images and managers keep working; a rename would be a bridge protocol change.
 */
export const MICROVM_TOOLS_DIR = MICROVM_INSTALL_DIR;

/** Guest tools of the generic launcher (own loader + libraries, independent of the guest image's libc). */
export const MICROVM_GUEST_TOOLS_DIR = `${MICROVM_TOOLS_DIR}/guest-tools`;

/** Where the generic guest agent finds the guest tools (virtio-fs tag `lwtools`, read-only) and the image root. */
export const MICROVM_GUEST_TOOLS_MOUNT = '/tools';
export const MICROVM_GENERIC_GUEST_ROOT = '/newroot';

/**
 * Capabilities of a microVM launcher container (a strict subset of Docker's defaults): virtiofsd needs them to give
 * the guest root normal file semantics and to confine itself to its shared directory (chroot sandbox); the VMM itself
 * runs unprivileged. Never NET_ADMIN / NET_RAW / SYS_ADMIN: the launcher may share another network namespace (the
 * egress guard's), and tap devices are created by the node agent, not the launcher.
 */
export const MICROVM_LAUNCHER_CAPABILITIES: readonly string[] = [
  'CHOWN',
  'DAC_OVERRIDE',
  'FOWNER',
  'FSETID',
  'SETUID',
  'SETGID',
  'MKNOD',
  'KILL',
  'SETPCAP',
  'SYS_CHROOT',
] as const;

/** Host device every microVM launcher needs. */
export const MICROVM_KVM_DEVICE = '/dev/kvm';

/** Memory of the launcher itself (libvirt, QEMU, virtiofsd, bridge) on top of the guest's memory. */
export const MICROVM_LAUNCHER_OVERHEAD_MIB = 384;

/** Launcher exit status when the microVM could not be started (`docker run` convention for runtime failures). */
export const MICROVM_LAUNCH_FAILED_EXIT_CODE = 125;

/**
 * Per-replica run directory of a generic microVM / full VM, bind-mounted by the node agent (read-only except
 * `stats/`): `boot-process.json` (workload process), `net.json` (guest addressing), `vm.json` (full VMs), `seed/`.
 */
export const MICROVM_RUN_CONFIG_DIR = '/run/loadweaver/vm';

/** Guest statistics written by the launcher daemon (`STATS` messages), read by the node agent's metrics collector. */
export const MICROVM_STATS_FILE = `${MICROVM_RUN_CONFIG_DIR}/stats/stats.json`;

/** How often the guest agent reports `STATS` when the launcher asked for them. */
export const MICROVM_STATS_INTERVAL_SECONDS = 10;

/** Link-local gateways of a generic microVM / full VM (guest owns the workload IP; tc-redirected tap). */
export const MICROVM_TAP_GATEWAY_V4 = '169.254.1.1';
export const MICROVM_TAP_GATEWAY_V6 = 'fe80::1';

/** Tap device the node agent pre-creates in the launcher's network namespace (`lwtap<n>` for further NICs). */
export const MICROVM_TAP_PREFIX = 'lwtap';

/**
 * Launcher image labels for QEMU live migration of microVMs (M7 W10b, bundled M7 F5): the launcher modes that can
 * receive and send a live migration (comma-separated, `generic,vm,bundled` since F5: Agenstra's bundled `launch` has
 * a migration / incoming mode, which bundled images inherit with the label; images built on an older launcher carry
 * `generic,vm` and fall back), and the pinned QEMU / virtiofsd package versions (vhost-user-fs state migration needs
 * QEMU >= 10.0 and virtiofsd >= 1.13 `--migration-mode`; QEMU migrates the device state on its own when the back-end
 * supports it — there is no device property, combined gate G3 / spike S7).
 */
export const MICROVM_MIGRATION_LABEL = 'io.forepath.microvm.migration';
export const MICROVM_QEMU_VERSION_LABEL = 'io.forepath.microvm.qemu-version';
export const MICROVM_VIRTIOFSD_VERSION_LABEL = 'io.forepath.microvm.virtiofsd-version';

/**
 * Filesystem volumes of a generic microVM (M7 W10b): the node agent mounts them below this launcher directory (one
 * entry per volume, `<index>`), a separate virtiofsd (tag `lwvols`) shares it and the guest binds `<index>` to the
 * volume's target. Apart from the image root's virtiofsd, so a live migration can hand a volume over (source
 * virtiofsd gone, unmount, DRBD demote / promote, mount on the target) without touching the root's state.
 */
export const MICROVM_VOLUMES_MOUNT = '/lwvol';
export const MICROVM_VOLUMES_TAG = 'lwvols';

/**
 * Bridge re-attach after a live migration (M7 W10b): the guest port sees the launcher end disconnect (virtio-serial
 * `PORT_OPEN 0`: its reads return end-of-file), drops whatever it had of the old launcher daemon's stream, writes
 * this marker and a `HELLO { version, running }`. The new daemon (`--resync`) skips everything before the marker (a
 * frame torn by the switch-over can't desynchronize it) and treats a running workload as ready without a new BOOT.
 */
export const MICROVM_RESYNC_MARKER = Buffer.from('6c77ff7265737966e3a5017f6e63ff00', 'hex');

/**
 * Guest OOM priority: the bridge agent (and tini above it, set by the guest init) runs with `oom_score_adj` -1000,
 * so a workload that fills the guest's memory is OOM-killed itself (container exit 137) instead of the agent (the
 * guest would power off, exit 255). Workload and exec processes are spawned with 0 (see GuestAgent).
 */
export const MICROVM_GUEST_OOM_SCORE_ADJ_PATH = '/proc/self/oom_score_adj';
export const MICROVM_GUEST_AGENT_OOM_SCORE_ADJ = -1000;
export const MICROVM_GUEST_WORKLOAD_OOM_SCORE_ADJ = 0;
