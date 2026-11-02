import { backupBeforeUpdateOf, installedAppOf } from '@forepath/loadweaver/shared/util-model';

import type { PlanProgress, PlanResourceChange } from '../entities/plan.entity';
import type { VolumePlacementEntity } from '../entities/volume-placement.entity';
import { parseVolumeId } from './volume-deletions.utils';

/**
 * Backups before applying (P1): nothing of the plan is applied until they succeeded. Two sources:
 * - **app updates**: a plan that moves an installed app to a new version whose Deployment carries the
 *   `backup-before-update` marker for that version backs those volumes up;
 * - **listed volume backups** (`backup-volume` workload changes, e.g. an app uninstall with `dataPolicy: backup`):
 *   volumes of Deployments the plan deletes, backed up while the app still runs (its backup hooks need it).
 * The apply starts the backups, the plan tracker waits for them (phase `backup`, stored in `progress.backups`, so plans
 * already in that phase carry on unchanged), applies once all succeeded and fails the plan — nothing applied — when
 * one fails or the wait times out.
 */

const DEFAULT_TIMEOUT_MINUTES = 60;

/** How long the apply waits for the backups (`LOADWEAVER_PRE_UPDATE_BACKUP_TIMEOUT_MINUTES`, default 60, ≥ 1). */
export function preApplyBackupTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const minutes = Number(env['LOADWEAVER_PRE_UPDATE_BACKUP_TIMEOUT_MINUTES']);

  return (Number.isFinite(minutes) && minutes >= 1 ? minutes : DEFAULT_TIMEOUT_MINUTES) * 60_000;
}

/** Workload change action of a listed volume backup. */
export const VOLUME_BACKUP_ACTION = 'backup-volume';

export interface VolumeBackupChange {
  action: typeof VOLUME_BACKUP_ACTION;
  /** `<project>/<deployment>/<volume>`. */
  volume: string;
  /** Nodes holding a copy when planned (primary first). */
  nodes: string[];
  sizeBytes: number;
}

/**
 * Why listed volume backups can't be planned: invalid ids, duplicates, or a volume whose Deployment the plan doesn't
 * delete (updates back up through the app's marker instead).
 */
export function volumeBackupIssues(
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
        `volume ${id}: a backup before applying is listed only for volumes of a deployment the plan deletes (Deployment ${ref.project}/${ref.deployment})`,
      );
  }

  return issues;
}

/** The workload changes of listed volume backups, from the volumes' placements (unknown volumes are missing). */
export function volumeBackupChanges(
  ids: readonly string[],
  placements: readonly Pick<
    VolumePlacementEntity,
    'id' | 'primaryNode' | 'syncReplicas' | 'remoteReplicas' | 'sizeBytes'
  >[],
): { changes: VolumeBackupChange[]; missing: string[] } {
  const changes: VolumeBackupChange[] = [];
  const missing: string[] = [];

  for (const id of ids) {
    const placement = placements.find((p) => p.id === id);

    if (!placement) {
      missing.push(id);
      continue;
    }

    changes.push({
      action: VOLUME_BACKUP_ACTION,
      volume: id,
      nodes: [
        ...new Set([placement.primaryNode, ...(placement.syncReplicas ?? []), ...(placement.remoteReplicas ?? [])]),
      ].filter(Boolean),
      sizeBytes: Number(placement.sizeBytes) || 0,
    });
  }

  return { changes, missing };
}

/** One informational warning per listed backup: what the apply does first, and what a failure means. */
export function volumeBackupWarnings(changes: readonly VolumeBackupChange[]): Record<string, unknown>[] {
  return changes.map((c) => ({
    level: 'info',
    path: 'volumes',
    volume: c.volume,
    message: `backs up volume ${c.volume} before anything is applied; a failed backup fails the plan and nothing is applied`,
  }));
}

/** The listed volume backups a stored plan carries. */
export function volumeBackupsOf(
  workloadChanges: readonly Record<string, unknown>[] | null | undefined,
): VolumeBackupChange[] {
  return (workloadChanges ?? []).filter(
    (c): c is Record<string, unknown> & VolumeBackupChange =>
      c['action'] === VOLUME_BACKUP_ACTION && typeof c['volume'] === 'string' && !!parseVolumeId(c['volume'] as string),
  );
}

type Annotated = { annotations?: Record<string, string> } | null;

/**
 * Volumes (`<project>/<deployment>/<volume>`) to back up before applying: app version changes whose new Deployment
 * carries the marker for exactly that version, and the plan's listed volume backups (`backup-volume`). Only volumes
 * that exist (`existing`) are listed.
 */
export function preApplyBackupVolumes(
  changes: readonly Pick<PlanResourceChange, 'action' | 'kind' | 'name' | 'project' | 'before' | 'after'>[],
  existing: ReadonlySet<string>,
  workloadChanges: readonly Record<string, unknown>[] | null = null,
): string[] {
  const volumes = new Set<string>();

  for (const backup of volumeBackupsOf(workloadChanges)) if (existing.has(backup.volume)) volumes.add(backup.volume);

  for (const change of changes) {
    if (change.kind !== 'Deployment' || change.action !== 'update' || !change.project) continue;

    const before = installedAppOf((change.before as Annotated)?.annotations);
    const after = installedAppOf((change.after as Annotated)?.annotations);
    const marker = backupBeforeUpdateOf((change.after as Annotated)?.annotations);

    if (!after || !marker || marker.version !== after.version || before?.version === after.version) continue;

    for (const volume of marker.volumes) {
      const id = `${change.project}/${change.name}/${volume}`;

      if (existing.has(id)) volumes.add(id);
    }
  }

  return [...volumes].sort();
}

/** The progress of the backup phase (no backup started yet: ids follow once they are). */
export function backupProgress(volumes: readonly string[], baseRevision: number, by: string | null): PlanProgress {
  return {
    phase: 'backup',
    baseRevision,
    targets: null,
    step: `Backing up before applying: 0 / ${volumes.length} volume(s)`,
    percent: 0,
    startedAt: new Date().toISOString(),
    nodes: {},
    backups: Object.fromEntries(volumes.map((v) => [v, null])),
    ...(by ? { by } : {}),
  };
}

export type BackupPhaseOutcome =
  | { state: 'starting'; missing: string[] }
  | { state: 'running'; done: number; total: number }
  | { state: 'succeeded' }
  | { state: 'failed'; failure: string };

/** Where the backup phase stands: backups still to start, running, all succeeded, or a failure / timeout. */
export function backupPhaseOutcome(
  progress: Pick<PlanProgress, 'backups' | 'startedAt'>,
  rows: readonly { id: string; status: string; error: string | null }[],
  now: number,
  timeoutMs: number,
): BackupPhaseOutcome {
  const entries = Object.entries(progress.backups ?? {});
  const failed: string[] = [];
  let done = 0;

  for (const [volume, id] of entries) {
    if (!id) continue;

    const row = rows.find((r) => r.id === id);

    if (!row) failed.push(`${volume}: the backup record is gone`);
    else if (row.status === 'succeeded') done += 1;
    else if (row.status !== 'running') failed.push(`${volume}: ${row.error ?? row.status}`);
  }

  if (failed.length) return { state: 'failed', failure: `the backup before applying failed (${failed.join('; ')})` };

  const missing = entries.filter(([, id]) => !id).map(([volume]) => volume);

  if (done === entries.length) return { state: 'succeeded' };

  if (now - Date.parse(progress.startedAt) > timeoutMs)
    return {
      state: 'failed',
      failure: `the backup before applying did not finish within ${Math.round(timeoutMs / 60_000)} minutes`,
    };

  return missing.length ? { state: 'starting', missing } : { state: 'running', done, total: entries.length };
}
