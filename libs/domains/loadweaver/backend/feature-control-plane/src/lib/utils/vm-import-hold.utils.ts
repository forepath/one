import { VM_DEPLOYMENT_NAME } from '@forepath/loadweaver/shared/util-model';
import type { ReplicaPlacement, ScheduleResult, VolumePlacement } from '@forepath/loadweaver/shared/util-scheduler';

import type { WorkloadPlacementEntity } from '../entities/workload-placement.entity';
import type { DeploymentIssue } from './workload-planning.utils';

/**
 * Boot-disk import phases that hold planned moves of a VM (M7 F4): the node is still writing the disk from the image,
 * a move now would leave a half-written disk that the next node adopts. `failed` doesn't hold (the import retries
 * on the node, a move restarts it elsewhere).
 */
export const VM_IMPORT_HOLD_PHASES: readonly string[] = ['queued', 'fetching', 'writing'];

/** A VM replica whose first boot-disk import runs on its node. */
export interface VmImportHold {
  replica: string;
  /** `project/lw-vm/<vm>` */
  service: string;
  project: string;
  vm: string;
  node: string;
  phase: string;
  bytes?: number;
  totalBytes?: number;
}

const MiB = 1024 * 1024;

/**
 * VM replicas whose boot disk reports an import in progress on their (reachable) node. Unreachable nodes hold
 * nothing: node loss / failover moves the VM as before (accepted risk, F3b); cron runs and draining replicas are
 * not planned anyway.
 */
export function vmImportHolds(
  placements: readonly Pick<
    WorkloadPlacementEntity,
    'id' | 'project' | 'deployment' | 'service' | 'node' | 'status' | 'cronRun' | 'drainUntil'
  >[],
  reachable: ReadonlySet<string>,
): Map<string, VmImportHold> {
  const holds = new Map<string, VmImportHold>();

  for (const p of placements) {
    if (p.deployment !== VM_DEPLOYMENT_NAME || p.cronRun || p.drainUntil || !reachable.has(p.node)) continue;

    const progress = p.status?.[p.node]?.vm?.importProgress;

    if (!progress || !VM_IMPORT_HOLD_PHASES.includes(progress.phase)) continue;

    holds.set(p.id, {
      replica: p.id,
      service: `${p.project}/${p.deployment}/${p.service}`,
      project: p.project,
      vm: p.service,
      node: p.node,
      phase: progress.phase,
      ...(typeof progress.bytes === 'number' ? { bytes: progress.bytes } : {}),
      ...(typeof progress.totalBytes === 'number' ? { totalBytes: progress.totalBytes } : {}),
    });
  }

  return holds;
}

/** "writing, 512 MiB of 2048 MiB" / "fetching, 100 MiB" / "queued". */
export function importProgressText(hold: Pick<VmImportHold, 'phase' | 'bytes' | 'totalBytes'>): string {
  if (hold.bytes === undefined) return hold.phase;

  const done = `${Math.round(hold.bytes / MiB)} MiB`;

  return hold.totalBytes
    ? `${hold.phase}, ${done} of ${Math.round(hold.totalBytes / MiB)} MiB`
    : `${hold.phase}, ${done}`;
}

/** Why a VM doesn't move (plan notes, drain logs). */
export function importHoldReason(hold: VmImportHold): string {
  return `virtual machine ${hold.project}/${hold.vm} is waiting for the boot-disk import on ${hold.node} (${importProgressText(hold)})`;
}

export interface HeldVmMove {
  hold: VmImportHold;
  /** Where the plan would have moved it; null when it couldn't be placed elsewhere either. */
  to: string | null;
}

/**
 * Keeps importing VMs where they are (M7 F4): a planned move (rebalancing, drain, selector / placement changes) or an
 * unschedulable VM replica goes back to its current node, its disk volumes keep their current holders. The VM moves
 * on the first plan after the import finished.
 */
export function holdVmImports(
  result: ScheduleResult,
  current: { volumes: readonly VolumePlacement[] },
  holds: ReadonlyMap<string, VmImportHold>,
  volumeOwners: ReadonlyMap<string, string>,
): { schedule: ScheduleResult; held: HeldVmMove[] } {
  if (holds.size === 0) return { schedule: result, held: [] };

  const held: HeldVmMove[] = [];
  const replicas: ReplicaPlacement[] = result.replicas.map((r) => {
    const hold = holds.get(r.replica);

    if (!hold || hold.node === r.node) return r;

    held.push({ hold, to: r.node });

    return { ...r, node: hold.node };
  });
  const placed = new Set(replicas.map((r) => r.replica));
  const unschedulable = result.unschedulable.filter((u) => {
    const ids = u.replica
      ? [u.replica]
      : [...holds.values()].filter((h) => h.service === u.service).map((h) => h.replica);
    const kept = ids.map((id) => holds.get(id)).filter((h): h is VmImportHold => !!h && !placed.has(h.replica));

    for (const hold of kept) {
      held.push({ hold, to: null });
      replicas.push({ service: hold.service, replica: hold.replica, node: hold.node });
      placed.add(hold.replica);
    }

    return kept.length === 0;
  });
  const heldServices = new Set(held.map((h) => h.hold.service));
  const currentVolumes = new Map(current.volumes.map((v) => [v.volume, v]));
  const volumes = result.volumes.map((v) =>
    heldServices.has(volumeOwners.get(v.volume) ?? '') && currentVolumes.has(v.volume)
      ? (currentVolumes.get(v.volume) as VolumePlacement)
      : v,
  );
  // An unschedulable VM got no volume placement: its disks stay where they are.
  const scheduled = new Set(volumes.map((v) => v.volume));

  for (const v of current.volumes)
    if (!scheduled.has(v.volume) && heldServices.has(volumeOwners.get(v.volume) ?? '')) volumes.push(v);

  return { schedule: { ...result, replicas, volumes, unschedulable }, held };
}

/** Plan notes for held VM moves. */
export function importHoldIssues(held: readonly HeldVmMove[]): DeploymentIssue[] {
  return held.map(({ hold, to }) => ({
    level: 'warning' as const,
    project: hold.project,
    deployment: VM_DEPLOYMENT_NAME,
    path: `${hold.vm}.placement`,
    message:
      `${hold.vm} stays on ${hold.node} while waiting for the boot-disk import (${importProgressText(hold)}); ` +
      (to ? `it moves to ${to} once the import finished` : 'plan again once the import finished'),
  }));
}

/** The leave refusal's hint at VMs a drain waits for (M7 F4): "" when none of the node's replicas imports. */
export function drainImportNote(placements: Parameters<typeof vmImportHolds>[0], node: string): string {
  const waiting = [...vmImportHolds(placements, new Set([node])).values()].filter((h) => h.node === node);

  return waiting.length > 0 ? `; the drain waits: ${waiting.map(importHoldReason).join('; ')}` : '';
}
