import { join } from 'node:path';

import {
  MICROVM_INSTALL_DIR,
  MICROVM_PROTOCOL_LABEL,
  toMicrovmExecOptions,
  type DockerExecCreateOptions,
} from '@forepath/shared/backend/util-microvm-bridge';

/**
 * Container label of a microVM replica (M7.2): `bundled` (the image is its own launcher, Agenstra's labelled worker
 * images) or `generic` (the pinned launcher; the service image is the guest root). Set by the workload container.
 */
export const MICROVM_LABEL = 'loadweaver.com/microvm';
/** Container label of a full VM replica (M7.3): the VM's name (`VirtualMachine` workloads, `<p>/lw-vm/<name>/0`). */
export const VM_LABEL = 'loadweaver.com/vm';
/** Where the generic launcher sees the guest's root (the host's per-replica overlay `merged/`, bind-mounted). */
export const GENERIC_GUEST_MOUNT = '/guest';
/** Where a bundled launcher image carries its guest root (inside the image, `io.forepath.scan.nested-rootfs`). */
export const BUNDLED_GUEST_DIR = '/guest';
/** The console relay of the launcher (agent-internal command: never user input, never rewritten to `vm-exec`). */
export const VM_CONSOLE_PATH = `${MICROVM_INSTALL_DIR}/vm-console`;

/**
 * What a replica's container is, for live sessions: a plain container (exec and files as they are), a microVM (exec
 * through `vm-exec` into the guest, files in the guest's root) or a full VM (no exec, no file browser: consoles only).
 */
export type GuestKind = 'container' | 'microvm-bundled' | 'microvm-generic' | 'vm';

export function guestKind(labels: Record<string, string> | null | undefined): GuestKind {
  if (!labels) return 'container';

  if (labels[VM_LABEL]) return 'vm';

  if (labels[MICROVM_LABEL] === 'generic') return 'microvm-generic';

  // Loadweaver's bundled mode, or any launcher-labelled image (the image label is part of the container's labels).
  if (labels[MICROVM_LABEL] === 'bundled' || labels[MICROVM_PROTOCOL_LABEL]) return 'microvm-bundled';

  return 'container';
}

export const isMicrovm = (kind: GuestKind): boolean => kind === 'microvm-bundled' || kind === 'microvm-generic';

/** Full VMs have no exec bridge in the guest: their way in is the serial console (or the guest's own SSH). */
export const VM_EXEC_REFUSED = 'virtual machines have no exec: open the serial console instead';

/**
 * Docker exec options for a live terminal / machine exec in a replica: in a microVM the command runs inside the guest
 * through the launcher's `vm-exec` client (TTY and resize are carried by the bridge; env values stay in `Env`, only
 * their names travel as arguments). Plain containers are unchanged; full VMs are refused.
 */
export function guestExecOptions<T extends DockerExecCreateOptions>(kind: GuestKind, options: T): T {
  if (kind === 'vm') throw new Error(VM_EXEC_REFUSED);

  return isMicrovm(kind) ? toMicrovmExecOptions(options) : options;
}

interface InspectForFiles {
  GraphDriver?: { Data?: unknown } | null;
  Mounts?: { Type?: string; Source?: string; Destination?: string }[] | null;
}

/**
 * The host directory holding a microVM guest's root, for the file browser: generic mode the replica's overlay
 * `merged/` (the bind source of the launcher's `/guest`; coherence with the guest is bounded by virtio-fs
 * `cache=auto`), bundled mode the guest root inside the image (`MergedDir` + `/guest`). `null` for other kinds.
 */
export function guestFileRoot(kind: GuestKind, info: InspectForFiles): string | null {
  if (kind === 'vm') throw new Error('virtual machine disks are not browsable');

  if (kind === 'microvm-generic') {
    const mount = (info.Mounts ?? []).find((m) => m.Destination === GENERIC_GUEST_MOUNT && m.Type === 'bind');

    if (!mount?.Source) throw new Error("the microVM's guest root is not mounted");

    return mount.Source;
  }

  if (kind === 'microvm-bundled') {
    const merged = (info.GraphDriver?.Data as Record<string, string> | undefined)?.['MergedDir'];

    if (!merged) throw new Error('this container runtime has no browsable filesystem');

    return join(merged, BUNDLED_GUEST_DIR);
  }

  return null;
}
