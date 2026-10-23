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
