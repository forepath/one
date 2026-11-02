import type { PlanResourceChange } from '../entities/plan.entity';
import type { VolumePlacementEntity } from '../entities/volume-placement.entity';

/**
 * Deleting volumes (app uninstall with `dataPolicy: delete`, P1): a plan lists them as workload changes
 * `delete-volume`. They are deleted only together with their Deployment in the same plan, and only once the plan was
 * applied (a failed / rolled-back apply never loses data): the placement goes, and the nodes drop the DRBD replica,
 * LUKS mapping and logical volume like every replica the control plane moved away. Backups are kept (retention).
 */

/** Draft op kind for a volume deletion (`name` = `<deployment>/<volume>`); planned as `deleteVolumes`. */
export const VOLUME_DRAFT_KIND = 'Volume';

/** A volume's name inside its deployment (the last part of a volume id). */
export const VOLUME_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** `<project>/<deployment>/<volume>`. */
export const VOLUME_ID_PATTERN =
  /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\/[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export interface VolumeDeletionChange {
  action: 'delete-volume';
  /** `<project>/<deployment>/<volume>`. */
  volume: string;
  /** Nodes holding a copy when planned (primary first). */
  nodes: string[];
  sizeBytes: number;
}

export function parseVolumeId(id: string): { project: string; deployment: string; volume: string } | null {
  if (!VOLUME_ID_PATTERN.test(id)) return null;

  const [project, deployment, ...rest] = id.split('/');

  return { project, deployment, volume: rest.join('/') };
}

/**
 * Why volume deletions can't be planned: invalid ids, duplicates, or a volume whose Deployment this plan doesn't
 * delete (a volume of a running or kept deployment is never removed by a plan).
 */
export function volumeDeletionIssues(
  ids: readonly string[],
  changes: readonly Pick<PlanResourceChange, 'action' | 'kind' | 'name' | 'project'>[],
): string[] {
  const issues: string[] = [];
  const seen = new Set<string>();

  for (const id of ids) {
    const ref = parseVolumeId(id);

    if (!ref) {
      issues.push(`volume ${id}: not <project>/<deployment>/<volume>`);
      continue;
    }

    if (seen.has(id)) issues.push(`volume ${id} is listed twice`);

    seen.add(id);

    if (
      !changes.some(
        (c) =>
          c.action === 'delete' && c.kind === 'Deployment' && c.project === ref.project && c.name === ref.deployment,
      )
    )
      issues.push(
        `volume ${id}: volumes are deleted only together with their deployment (delete Deployment ${ref.project}/${ref.deployment} in the same plan)`,
      );
  }

  return issues;
}

/** The workload changes of the deletions, from the volumes' placements (unknown volumes are an error). */
export function volumeDeletionChanges(
  ids: readonly string[],
  placements: readonly Pick<
    VolumePlacementEntity,
    'id' | 'primaryNode' | 'syncReplicas' | 'remoteReplicas' | 'sizeBytes'
  >[],
): { changes: VolumeDeletionChange[]; missing: string[] } {
  const changes: VolumeDeletionChange[] = [];
  const missing: string[] = [];

  for (const id of ids) {
    const placement = placements.find((p) => p.id === id);

    if (!placement) {
      missing.push(id);
      continue;
    }

    changes.push({
      action: 'delete-volume',
      volume: id,
      nodes: [
        ...new Set([placement.primaryNode, ...(placement.syncReplicas ?? []), ...(placement.remoteReplicas ?? [])]),
      ].filter(Boolean),
      sizeBytes: Number(placement.sizeBytes) || 0,
    });
  }

  return { changes, missing };
}

/** One warning per deleted volume; `destructive` makes the apply need `confirm: true`. */
export function volumeDeletionWarnings(changes: readonly VolumeDeletionChange[]): Record<string, unknown>[] {
  return changes.map((c) => ({
    level: 'warning',
    path: 'volumes',
    volume: c.volume,
    destructive: true,
    message: `deletes volume ${c.volume} and its data${c.nodes.length ? ` on ${c.nodes.join(', ')}` : ''} once the plan is applied; backups are kept and follow their retention`,
  }));
}

/** Per project: the data loss as a risk (the `risky` approval mode then needs an approval). */
export function volumeDeletionRisk(changes: readonly VolumeDeletionChange[]): Record<string, string[]> {
  const risk: Record<string, string[]> = {};

  for (const c of changes) {
    const ref = parseVolumeId(c.volume);

    if (ref) (risk[ref.project] ??= []).push(`deletes the data of volume ${c.volume}`);
  }

  return risk;
}

/** Merges risk reasons per project. */
export function mergeRisk(base: Record<string, string[]>, extra: Record<string, string[]>): Record<string, string[]> {
  const merged: Record<string, string[]> = { ...base };

  for (const [project, reasons] of Object.entries(extra)) merged[project] = [...(merged[project] ?? []), ...reasons];

  return merged;
}

/** The volume deletions a stored plan carries. */
export function volumeDeletionsOf(
  workloadChanges: readonly Record<string, unknown>[] | null | undefined,
): VolumeDeletionChange[] {
  return (workloadChanges ?? []).filter(
    (c): c is Record<string, unknown> & VolumeDeletionChange =>
      c['action'] === 'delete-volume' && typeof c['volume'] === 'string' && !!parseVolumeId(c['volume'] as string),
  );
}

/** Whether a plan's warnings contain changes the apply has to confirm: unacknowledged pins or data deletions. */
export function confirmationsNeeded(warnings: readonly Record<string, unknown>[] | null | undefined): {
  pins: boolean;
  destructive: boolean;
} {
  return {
    pins: (warnings ?? []).some((w) => w['pin'] === true),
    destructive: (warnings ?? []).some((w) => w['destructive'] === true),
  };
}
