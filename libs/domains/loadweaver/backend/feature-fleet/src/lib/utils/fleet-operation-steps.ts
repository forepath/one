import type {
  FleetOperationKind,
  FleetOperationStatus,
  FleetOperationStep,
  FleetStepStatus,
} from '../entities/fleet-operation.entity';

/**
 * Step plans of fleet operations (3.20 cross-cluster restore / clone, section 4 final backup). Every step is
 * idempotent on its own (it records what it created and re-uses it on a retry), runs as one queue unit job and is
 * audited; `waiting` steps are polled by the operations coordinator until the cluster reports a result.
 */

export interface RestoreOperationParams {
  /** Backups of the source cluster and the target volume name each is restored into. */
  backups: { backupId: string; volume: string }[];
  /** Target deployment on the target cluster (must exist, or is created by the clone step). */
  target: { project: string; deployment: string };
  mode: 'replace' | 'merge';
  /** Apply the plans (still subject to the target cluster's approvals); otherwise they wait in the target cluster. */
  apply: boolean;
  /** Clone: the source deployment whose resource is copied to the target first. */
  clone?: { project: string; deployment: string };
}

export const RESTORE_STEPS = ['validate', 'transfer', 'restore-plan', 'restore-apply', 'restore-wait'] as const;
export const CLONE_STEPS = [
  'validate',
  'deployment-plan',
  'deployment-apply',
  'transfer',
  'restore-plan',
  'restore-apply',
  'restore-wait',
] as const;
export const FINAL_BACKUP_STEPS = [
  'platform-postgres',
  'platform-opensearch',
  'platform-etcd',
  'volumes',
  'volumes-wait',
  'copies',
] as const;

/** Final backups are best effort: a failing step does not stop the others (everything that can be saved is). */
export function isBestEffort(kind: FleetOperationKind): boolean {
  return kind === 'final-backup';
}

export function stepKeys(kind: FleetOperationKind): readonly string[] {
  if (kind === 'clone') return CLONE_STEPS;

  if (kind === 'final-backup') return FINAL_BACKUP_STEPS;

  return RESTORE_STEPS;
}

export function initialSteps(kind: FleetOperationKind): FleetOperationStep[] {
  return stepKeys(kind).map((key) => ({
    key,
    status: 'pending',
    startedAt: null,
    finishedAt: null,
    detail: {},
    error: null,
    attempts: 0,
  }));
}

const DONE: readonly FleetStepStatus[] = ['succeeded', 'skipped', 'failed'];

/** The step to run next: the first one not done (a `waiting` / `running` step is resumed). */
export function currentStep(steps: readonly FleetOperationStep[]): FleetOperationStep | null {
  return steps.find((s) => !DONE.includes(s.status)) ?? null;
}

export function updateStep(
  steps: readonly FleetOperationStep[],
  key: string,
  patch: Partial<FleetOperationStep>,
  now = new Date(),
): FleetOperationStep[] {
  return steps.map((s) => {
    if (s.key !== key) return s;

    const status = patch.status ?? s.status;

    return {
      ...s,
      ...patch,
      detail: { ...s.detail, ...(patch.detail ?? {}) },
      startedAt: s.startedAt ?? (status !== 'pending' ? now.toISOString() : null),
      finishedAt: DONE.includes(status) ? now.toISOString() : null,
    };
  });
}

/**
 * Status of the whole operation: failed as soon as a step failed (best-effort operations only once all steps are
 * done), waiting while the current step waits, succeeded when every step succeeded or was skipped.
 */
export function operationStatus(kind: FleetOperationKind, steps: readonly FleetOperationStep[]): FleetOperationStatus {
  const failed = steps.some((s) => s.status === 'failed');
  const current = currentStep(steps);

  if (failed && (!isBestEffort(kind) || !current)) return 'failed';

  if (!current) return 'succeeded';

  return current.status === 'waiting' ? 'waiting' : 'running';
}

const NAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const VOLUME = /^[a-z0-9_.-]{1,63}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Validates and normalises restore / clone input (the DTO already checked the shape). */
export function validateRestoreParams(
  kind: 'cross-cluster-restore' | 'clone',
  params: RestoreOperationParams,
): string[] {
  const errors: string[] = [];

  if (!params.backups.length || params.backups.length > 16) errors.push('between 1 and 16 backups');

  for (const b of params.backups) {
    if (!UUID.test(b.backupId)) errors.push(`invalid backup id ${b.backupId}`);

    if (!VOLUME.test(b.volume)) errors.push(`invalid volume ${b.volume}`);
  }

  if (new Set(params.backups.map((b) => b.volume)).size !== params.backups.length)
    errors.push('each target volume at most once');

  if (!NAME.test(params.target.project) || !NAME.test(params.target.deployment)) errors.push('invalid target');

  if (kind === 'clone' && (!params.clone || !NAME.test(params.clone.project) || !NAME.test(params.clone.deployment)))
    errors.push('clone needs the source deployment');

  if (kind === 'cross-cluster-restore' && params.clone) errors.push('restore has no source deployment');

  return errors;
}

/** Name of the `Restore` resource created on the target (stable per operation and volume, so a retry re-uses it). */
export function restoreResourceName(operationId: string, volume: string): string {
  const base = `fleet-${operationId.slice(0, 8)}-${volume.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`;

  return base.slice(0, 63).replace(/-+$/, '');
}

/** JSON is YAML: the plan bundle as `---`-separated JSON documents. */
export function planBundle(documents: readonly Record<string, unknown>[]): string {
  return documents.map((d) => JSON.stringify(d)).join('\n---\n');
}

export const LOADWEAVER_RESOURCE_API_VERSION = 'loadweaver.com/v1';

export function restoreDocuments(
  operationId: string,
  params: RestoreOperationParams,
  imported: Record<string, string>,
): Record<string, unknown>[] {
  return params.backups.map((b) => ({
    apiVersion: LOADWEAVER_RESOURCE_API_VERSION,
    kind: 'Restore',
    metadata: { name: restoreResourceName(operationId, b.volume), project: params.target.project },
    spec: {
      description: `Fleet operation ${operationId}: backup ${b.backupId} of another cluster`,
      backup: imported[b.backupId],
      target: { deployment: params.target.deployment, volume: b.volume, mode: params.mode },
    },
  }));
}

/**
 * The source deployment rewritten for the target (clone): same spec, target project / name, labels kept,
 * server-side fields (status, ids, timestamps) dropped. Groups and policies are matched by name on the target
 * (3.20 "remapped"); the plan shows what does not resolve there.
 */
export function cloneDeploymentDocument(
  source: { kind?: string; metadata?: Record<string, unknown>; spec?: unknown },
  target: { project: string; deployment: string },
): Record<string, unknown> {
  if (source.kind !== 'Deployment' || !source.spec) throw new Error('the source is not a deployment');

  const labels = (source.metadata?.['labels'] as Record<string, string> | undefined) ?? undefined;

  return {
    apiVersion: LOADWEAVER_RESOURCE_API_VERSION,
    kind: 'Deployment',
    metadata: { name: target.deployment, project: target.project, ...(labels ? { labels } : {}) },
    spec: source.spec,
  };
}

/** Plan states that end the wait of an apply step. */
export function planOutcome(status: string | undefined): 'applied' | 'failed' | 'pending' {
  if (status === 'applied') return 'applied';

  if (status && ['failed', 'rolled-back', 'rollback-failed', 'discarded'].includes(status)) return 'failed';

  return 'pending';
}

/** Restore states (`RestoreEntity.status`: pending / running / done / failed) that end the wait. */
export function restoreOutcome(status: string | undefined): 'succeeded' | 'failed' | 'pending' {
  if (status === 'done') return 'succeeded';

  if (status === 'failed') return 'failed';

  return 'pending';
}
