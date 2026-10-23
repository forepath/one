import {
  parseVmQuantity,
  vmDiskVolumeId,
  vmReplicaId,
  type VirtualMachineSpec,
} from '@forepath/loadweaver/shared/util-model';

import type { VmImageInspection } from './microvm-planning.utils';
import { nicFamilies, vmNicAddresses, vmNicMac, vmUid } from './vm-planning.utils';

/**
 * Status of full virtual machines (3.35, M7.3) for the lifecycle API: phase, NICs, disks, consoles and the power
 * actions a VM's state allows. Pure functions over the resource, its placement, volume placements and nodes.
 */

export const VM_PHASES = [
  'Pending',
  'Importing',
  'Starting',
  'Running',
  'Stopping',
  'Stopped',
  'Migrating',
  'Failed',
] as const;
export type VmPhase = (typeof VM_PHASES)[number];

/**
 * Lifecycle actions: `start` / `stop` / `force-off` change the operational power of `Manual` VMs (replica presence);
 * `reboot` (ACPI), `reset` (hard) and `shutdown` (ACPI, `Manual` only — the VM stays off) go to the node as
 * `vmPower`; `reimage` rewrites a stopped VM's boot disk from its pinned image (`vmImageImport`).
 */
export const VM_ACTIONS = ['start', 'stop', 'force-off', 'shutdown', 'reboot', 'reset', 'reimage'] as const;
export type VmAction = (typeof VM_ACTIONS)[number];

export type VmDesiredPower = 'running' | 'stopped';

/** The replica's placement as far as the status needs it. */
export interface VmPlacementView {
  node: string;
  addresses: string[];
  targetNode: string | null;
  migration: unknown;
  drainUntil: Date | string | null;
  status: Record<
    string,
    {
      state: string;
      exitCode?: number;
      message?: string;
      /** Guest power (`VM_POWER_STATES`, from `virsh domstate`) and a boot disk being written (W9). */
      vm?: {
        power?: string;
        importing?: boolean;
        importProgress?: { phase: string; bytes?: number; totalBytes?: number };
      };
      at: string;
    }
  > | null;
}

export interface VmVolumeView {
  id: string;
  primaryNode: string;
  syncReplicas: string[];
  remoteReplicas: string[];
  crossSite: 'async' | 'sync' | 'none';
}

export interface VmNodeView {
  name: string;
  connected: boolean;
  protocolFeatures: string[];
}

export interface VmNicStatus {
  name: string;
  index: number;
  primary: boolean;
  mac: string;
  groups: string[];
  labels: Record<string, string>;
  families: ('v4' | 'v6')[];
  addresses: string[];
}

export interface VmDiskStatus {
  name: string;
  volume: string;
  source: 'image' | 'blank';
  boot: boolean;
  sizeBytes: number;
  bus: 'virtio';
  cache: 'none' | 'writeback';
  replicas: number | null;
  crossSite: 'async' | 'sync' | 'none' | null;
  /** Null until the volume is placed (first apply). */
  primaryNode: string | null;
  syncReplicas: string[];
  remoteReplicas: string[];
}

export interface VmConsoleAvailability {
  available: boolean;
  /** Why not, when unavailable. */
  reason?: string;
}

/** Whether the VM should run: `Always` yes, `Halted` no, `Manual` per its operational power (default running). */
export function vmShouldRun(spec: Pick<VirtualMachineSpec, 'runStrategy'>, power: VmDesiredPower | undefined): boolean {
  if (spec.runStrategy === 'Always') return true;

  if (spec.runStrategy === 'Halted') return false;

  return power !== 'stopped';
}

/** The node's last report of the replica, if any. */
export function vmReport(placement: VmPlacementView | null) {
  return placement?.status?.[placement.node] ?? null;
}

/**
 * Phase of a VM: `Stopped` / `Stopping` when it shouldn't run, `Pending` without a placement or report, `Migrating`
 * while it moves, else from the node's report (`pulling` / `pending` with an import message = `Importing`).
 */
export function vmPhase(shouldRun: boolean, placement: VmPlacementView | null): VmPhase {
  const draining = !!placement?.drainUntil;
  const report = vmReport(placement);

  if (!shouldRun || draining) {
    if (!placement) return 'Stopped';

    if (report?.vm?.power === 'shut-off') return 'Stopped';

    return report && ['running', 'healthy', 'unhealthy', 'starting'].includes(report.state) ? 'Stopping' : 'Stopped';
  }

  if (!placement) return 'Pending';

  if (placement.migration || placement.targetNode) return 'Migrating';

  if (!report) return 'Pending';

  if (report.vm?.importing) return 'Importing';

  // The guest's own power state wins once the launcher reports it (W9: `virsh domstate`).
  switch (report.vm?.power) {
    case 'running':
    case 'paused':
    case 'suspended':
      return 'Running';
    case 'shutting-down':
      return 'Stopping';
    case 'shut-off':
      return 'Stopped';
    case 'crashed':
      return 'Failed';
  }

  switch (report.state) {
    case 'running':
    case 'healthy':
    case 'unhealthy':
      return 'Running';
    case 'starting':
      return 'Starting';
    case 'exited':
    case 'failed':
      return 'Failed';
    default:
      return /import/i.test(report.message ?? '') ? 'Importing' : 'Starting';
  }
}

/** The NICs with MACs and the replica's addresses split per NIC (allocation order). */
export function vmNicStatus(
  project: string,
  name: string,
  spec: Pick<VirtualMachineSpec, 'nics'>,
  addresses: readonly string[],
): VmNicStatus[] {
  const uid = vmUid(project, name);
  const split = new Map(vmNicAddresses({ spec } as never, addresses).map((n) => [n.index, n.addresses]));

  return spec.nics.map((nic, index) => ({
    name: nic.name,
    index,
    primary: index === 0,
    mac: vmNicMac(uid, index, nic.name),
    groups: [...(nic.groups ?? [])],
    labels: { ...(nic.labels ?? {}) },
    families: nicFamilies(nic),
    addresses: split.get(index) ?? [],
  }));
}

/** The disks with their volume placements. */
export function vmDiskStatus(
  project: string,
  name: string,
  spec: Pick<VirtualMachineSpec, 'disks'>,
  volumes: readonly VmVolumeView[],
): VmDiskStatus[] {
  const byId = new Map(volumes.map((v) => [v.id, v]));

  return [...spec.disks]
    .sort((a, b) => Number(b.source === 'image') - Number(a.source === 'image'))
    .map((disk) => {
      const volume = vmDiskVolumeId(project, name, disk.name);
      const placed = byId.get(volume);

      return {
        name: disk.name,
        volume,
        source: disk.source,
        boot: disk.source === 'image',
        sizeBytes: parseVmQuantity(disk.size) ?? 0,
        bus: disk.bus,
        cache: disk.cache,
        replicas: disk.replicas ?? null,
        crossSite: placed?.crossSite ?? disk.crossSite ?? null,
        primaryNode: placed?.primaryNode ?? null,
        syncReplicas: placed?.syncReplicas ?? [],
        remoteReplicas: placed?.remoteReplicas ?? [],
      };
    });
}

/**
 * Console availability (consoles go through `socket/consoles`): the VM must be running or starting on a connected
 * node that advertises `vm-consoles`; the graphical one also needs `console.graphical`. `mayOpen`: the caller's role
 * (as terminals: operators / admins, developers with `developerExec`).
 */
export function vmConsoles(
  spec: Pick<VirtualMachineSpec, 'console'>,
  phase: VmPhase,
  node: VmNodeView | null,
  mayOpen: boolean,
): { serial: VmConsoleAvailability; vnc: VmConsoleAvailability } {
  const common = ((): VmConsoleAvailability => {
    if (!mayOpen) return { available: false, reason: 'your role may not open consoles in this project' };

    if (phase !== 'Running' && phase !== 'Starting' && phase !== 'Migrating')
      return { available: false, reason: 'the virtual machine is not running' };

    if (!node || !node.connected) return { available: false, reason: 'the node is not connected' };

    if (!node.protocolFeatures.includes('vm-consoles'))
      return { available: false, reason: 'the node does not support VM consoles (update its agent)' };

    return { available: true };
  })();

  return {
    serial: common,
    vnc: !spec.console.graphical
      ? { available: false, reason: 'the virtual machine has no graphical console (console.graphical: false)' }
      : common,
  };
}

/** The actions a VM's state allows (the caller's role is checked separately). */
export function vmAvailableActions(
  spec: Pick<VirtualMachineSpec, 'runStrategy'>,
  phase: VmPhase,
  power: VmDesiredPower | undefined,
): VmAction[] {
  const actions: VmAction[] = [];
  const manual = spec.runStrategy === 'Manual';
  const stopped = !vmShouldRun(spec, power);
  const live = phase === 'Running' || phase === 'Starting';

  if (manual && stopped) actions.push('start');

  if (manual && !stopped) actions.push('stop', 'force-off');

  if (manual && live) actions.push('shutdown');

  if (live) actions.push('reboot', 'reset');

  if (stopped && phase === 'Stopped') actions.push('reimage');

  return actions;
}

/** Why an action is refused in the VM's current state (409), or null when it is allowed. */
export function vmActionRefusal(
  action: VmAction,
  spec: Pick<VirtualMachineSpec, 'runStrategy'>,
  phase: VmPhase,
  power: VmDesiredPower | undefined,
): string | null {
  if (vmAvailableActions(spec, phase, power).includes(action)) return null;

  const manualOnly = action === 'start' || action === 'stop' || action === 'force-off' || action === 'shutdown';

  if (manualOnly && spec.runStrategy !== 'Manual')
    return `power is managed by the spec (runStrategy: ${spec.runStrategy}); change runStrategy to Manual through a plan`;

  switch (action) {
    case 'start':
      return 'the virtual machine is already running';
    case 'stop':
    case 'force-off':
      return 'the virtual machine is already stopped';
    case 'reimage':
      return 'stop the virtual machine first (reimage needs a stopped VM)';
    default:
      return `the virtual machine is not running (${phase})`;
  }
}

/** Replica id and disk volumes of a VM (re-exported for callers of the status). */
export function vmIds(project: string, name: string, spec: Pick<VirtualMachineSpec, 'disks'>) {
  return {
    replica: vmReplicaId(project, name),
    volumes: spec.disks.map((d) => vmDiskVolumeId(project, name, d.name)),
  };
}

/** Snapshot consistency: application-consistent when the pinned image runs the guest agent (fsfreeze). */
export function vmSnapshotConsistency(
  inspection: Pick<VmImageInspection, 'guestAgent'> | undefined,
): 'crash' | 'application' {
  return inspection?.guestAgent ? 'application' : 'crash';
}

/** Overall status of a snapshot from its disks' backups. */
export function vmSnapshotStatus(
  statuses: readonly (string | undefined)[],
): 'running' | 'succeeded' | 'failed' | 'partial' {
  if (statuses.some((s) => s === 'running' || s === undefined)) return 'running';

  const ok = statuses.filter((s) => s === 'succeeded').length;

  if (ok === statuses.length) return 'succeeded';

  return ok === 0 ? 'failed' : 'partial';
}
