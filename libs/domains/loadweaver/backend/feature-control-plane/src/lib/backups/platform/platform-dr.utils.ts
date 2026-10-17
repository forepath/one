import {
  backupTargetSpecSchema,
  clusterBackupsSchema,
  clusterSpecSchema,
  platformBackupSettings,
  type BackupTargetSpec,
  type ClusterPlatformBackups,
} from '@forepath/loadweaver/shared/util-model';
import type { DataSource, EntityManager } from 'typeorm';
import { In } from 'typeorm';

import { ResourceEntity } from '../../entities/resource.entity';
import type { PlatformCutoverPlan } from './platform-dr.entities';
import { PlatformCutoverEntity } from './platform-dr.entities';
import type { PlatformBackupKind } from './platform-backups.utils';

/**
 * Whole-cluster disaster recovery and the remaining backup gaps of 3.20 (M6 step 3c), pure parts: which targets get
 * the external copy, platform retention under the second-admin + delay rule, the cut-over plan, the DR info document.
 */

/** The cluster's platform-backup settings (`Cluster.spec.backups.platform`, defaults when absent). */
export async function platformSettings(dataSource: DataSource | EntityManager): Promise<ClusterPlatformBackups> {
  const cluster = await dataSource.getRepository(ResourceEntity).findOne({ where: { kind: 'Cluster' } });
  const parsed = cluster ? clusterSpecSchema.safeParse(cluster.spec) : null;

  return platformBackupSettings(parsed?.success ? parsed.data.backups : undefined);
}

/** Who last changed the `Cluster` resource (the requester of a retention shortening). */
export async function clusterUpdatedBy(dataSource: DataSource | EntityManager): Promise<string | null> {
  const cluster = await dataSource.getRepository(ResourceEntity).findOne({ where: { kind: 'Cluster' } });

  return cluster?.updatedBy ?? null;
}

/** Targets receiving the external copy: the named ones, or every declared `BackupTarget` when none are named. */
export function platformCopyTargets(
  settings: Pick<ClusterPlatformBackups, 'targets'>,
  declared: ReadonlyArray<{ name: string; spec: unknown }>,
): { targets: Array<{ name: string; spec: BackupTargetSpec }>; missing: string[] } {
  const parsed = declared.flatMap((d) => {
    const spec = backupTargetSpecSchema.safeParse(d.spec);

    return spec.success ? [{ name: d.name, spec: spec.data }] : [];
  });

  if (!settings.targets) return { targets: parsed, missing: [] };

  return {
    targets: parsed.filter((t) => settings.targets?.includes(t.name)),
    missing: settings.targets.filter((n) => !parsed.some((t) => t.name === n)),
  };
}

export async function declaredBackupTargets(
  dataSource: DataSource | EntityManager,
): Promise<Array<{ name: string; spec: unknown }>> {
  return (await dataSource.getRepository(ResourceEntity).find({ where: { kind: In(['BackupTarget']) } })).map((r) => ({
    name: r.name,
    spec: r.spec,
  }));
}

/** Pins of the platform backups (3.12 / 3.20): no external copy = the control plane doesn't survive losing the cluster. */
export function platformPins(settings: ClusterPlatformBackups, targets: number): string[] {
  if (!settings.enabled) return [];

  return targets === 0
    ? [
        "control-plane backups don't survive the loss of the cluster: no external backup target receives a copy of the platform backups",
      ]
    : [];
}

// ------------------------------------------------------------------------------------- retention gating

/** Retention key of one platform kind in `lw_backup_retention` / deletion requests. */
export function platformRetentionKey(kind: PlatformBackupKind): string {
  return `cluster:backups.platform/${kind}`;
}

/**
 * Platform retention (keep the newest N) under 3.20's rule: a longer retention applies at once; a shorter one keeps
 * the effective (longer) value until a second admin approved it and the delay passed.
 */
export function platformKeepDecision(
  effective: number | null,
  wanted: number,
): { apply: number; shorten: number | null } {
  if (effective === null || wanted >= effective) return { apply: wanted, shorten: null };

  return { apply: effective, shorten: wanted };
}

// ---------------------------------------------------------------------------------------------- cut-over

export async function activePostgresScope(dataSource: DataSource | EntityManager, clusterId: string): Promise<string> {
  const row = await dataSource
    .getRepository(PlatformCutoverEntity)
    .findOne({ where: { state: In(['switching', 'done']) }, order: { createdAt: 'DESC' } });

  return row?.scope ?? clusterId;
}

export interface CutoverMember {
  name: string;
  connected: boolean;
  features: readonly string[];
}

/** Why a cut-over can't be planned now (null = it can). */
export function cutoverRefusal(
  restore: { state: string; node: string } | null,
  members: readonly CutoverMember[],
  active: boolean,
): string | null {
  if (!restore) return 'the restore does not exist';

  if (restore.state !== 'ready') return `the restore is ${restore.state}; only a ready clone can be adopted`;

  if (active) return 'another cut-over is planned or running';

  if (!members.some((m) => m.name === restore.node)) return `${restore.node} is no longer a control-plane member`;

  const offline = members.filter((m) => !m.connected).map((m) => m.name);

  if (offline.length) return `every member must be connected (offline: ${offline.join(', ')})`;

  const old = members.filter((m) => !m.features.includes('platform-cutover')).map((m) => m.name);

  if (old.length) return `members without cut-over support (update their agents first): ${old.join(', ')}`;

  return null;
}

/** The plan shown before approval: steps, warnings, and from when data is lost. */
export function cutoverPlan(input: {
  restoreId: string;
  node: string;
  scope: string;
  previousScope: string;
  targetTime: Date | null;
  readyAt: Date | null;
  members: readonly string[];
  now: Date;
}): PlatformCutoverPlan {
  const lossAfter = input.targetTime ?? input.readyAt ?? input.now;
  const others = input.members.filter((m) => m !== input.node);

  return {
    members: [...input.members],
    dataLossAfter: lossAfter.toISOString(),
    steps: [
      `final base backup of the current database (scope ${input.previousScope}); it and its WAL stay under spilo/${input.previousScope}/`,
      `write the cut-over into the clone's database (scope ${input.scope})`,
      `${input.node}: stop the current database, keep its data directory as postgres.pre-<restore>, adopt the clone of restore ${input.restoreId} as lw-postgres (scope ${input.scope})`,
      ...(others.length
        ? [
            `${others.join(', ')}: keep the current data directory as postgres.pre-<restore>, start again as replicas of the clone`,
          ]
        : []),
      'the control plane continues on the clone; a new base backup starts point-in-time recovery under the new scope',
    ],
    warnings: [
      `Everything written to the control-plane database after ${lossAfter.toISOString()} is lost (resources, plans, nodes joined, secrets created, audit entries): the clone only holds data up to then.`,
      'The control plane is unavailable while the members switch (usually under a minute).',
      `The current database is not deleted: a final base backup stays under spilo/${input.previousScope}/ and each member keeps its old data directory until it is removed by hand.`,
      ...(input.targetTime && input.now.getTime() - input.targetTime.getTime() > 24 * 3_600_000
        ? ['The target time is more than a day old: nodes, deployments and secrets changed since will be unknown.']
        : []),
    ],
  };
}

// ------------------------------------------------------------------------------------------- DR info

export const DR_INFO_FORMAT = 'loadweaver-dr-info';

export interface DrInfoKey {
  generation: number;
  rootId: string;
  kitShares: number;
  kitThreshold: number;
  kitConfirmed: boolean;
  active: boolean;
  /** KMS-wrapped root (useless without the KMS), for `bootstrap --restore --kms`. */
  escrow: { provider: string; keyRef: string; wrapped: string } | null;
}

export interface DrInfoTarget {
  name: string;
  type: 's3' | 'sftp';
  endpoint?: string;
  bucket?: string;
  region?: string;
  prefix?: string;
  objectLock?: { mode: string; days: number } | null;
  host?: string;
  port?: number;
  user?: string;
  path?: string;
  knownHosts?: string;
  /** The secret holding the credentials in the cluster (gone with it: have a copy, e.g. a read-only key). */
  credentialsRef: string;
}

/** What `loadweaver-agent bootstrap --restore --dr-info` needs besides the kit and the target's credentials. */
export interface DrInfoDocument {
  format: typeof DR_INFO_FORMAT;
  version: 1;
  clusterId: string;
  postgresScope: string;
  createdAt: string;
  targets: DrInfoTarget[];
  keys: DrInfoKey[];
}

export function drInfoTarget(name: string, spec: BackupTargetSpec): DrInfoTarget {
  return spec.type === 's3'
    ? {
        name,
        type: 's3',
        endpoint: spec.endpoint,
        bucket: spec.bucket,
        region: spec.region,
        prefix: spec.prefix,
        objectLock: spec.objectLock ?? null,
        credentialsRef: spec.credentials,
      }
    : {
        name,
        type: 'sftp',
        host: spec.host,
        port: spec.port,
        user: spec.user,
        path: spec.path,
        knownHosts: spec.knownHosts,
        credentialsRef: spec.keySecret,
      };
}

// ------------------------------------------------------------------------------------------ plan warnings

interface PlanChangeView {
  action: 'create' | 'update' | 'delete' | 'unchanged';
  kind: string;
  name: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

function settingsOf(resource: Record<string, unknown> | null): ClusterPlatformBackups | null {
  const backups = clusterBackupsSchema.safeParse(
    (resource as { spec?: { backups?: unknown } } | null)?.spec?.backups ?? {},
  );

  return backups.success ? platformBackupSettings(backups.data) : null;
}

/**
 * Plan warnings for the control-plane data backups (3.20): a shortened `keep` stays ineffective until a second admin
 * approved it and the delay passed; a plan leaving the platform backups without an external target is a pin.
 */
export async function platformPlanWarnings(
  dataSource: DataSource | EntityManager,
  changes: readonly PlanChangeView[],
  delayHours: number,
): Promise<Record<string, unknown>[]> {
  const cluster = changes.find((c) => c.kind === 'Cluster' && c.action === 'update');
  const touchesTargets = changes.some((c) => c.kind === 'BackupTarget' && c.action !== 'unchanged');

  if (!cluster && !touchesTargets) return [];

  const warnings: Record<string, unknown>[] = [];
  const before = cluster ? settingsOf(cluster.before) : null;
  const after = cluster ? settingsOf(cluster.after) : await platformSettings(dataSource);

  if (before && after)
    for (const kind of ['postgres', 'opensearch', 'etcd'] as const)
      if (after[kind].keep < before[kind].keep)
        warnings.push({
          level: 'warning',
          path: `backups.platform.${kind}.keep`,
          message: `retention of the ${kind} platform backups shrinks from ${before[kind].keep} to ${after[kind].keep}: the longer retention stays in effect until a second cluster admin approves the request and ${delayHours} h passed`,
        });

  const backupsChanged =
    !!cluster &&
    JSON.stringify((cluster.before as { spec?: { backups?: unknown } } | null)?.spec?.backups ?? null) !==
      JSON.stringify((cluster.after as { spec?: { backups?: unknown } } | null)?.spec?.backups ?? null);

  if (after && (backupsChanged || touchesTargets)) {
    const declared = (await declaredBackupTargets(dataSource)).filter(
      (d) => !changes.some((c) => c.kind === 'BackupTarget' && c.name === d.name && c.action === 'delete'),
    );

    for (const c of changes)
      if (c.kind === 'BackupTarget' && c.action === 'create')
        declared.push({ name: c.name, spec: (c.after as { spec?: unknown } | null)?.spec });

    for (const message of platformPins(after, platformCopyTargets(after, declared).targets.length))
      warnings.push({ level: 'warning', path: 'backups.platform', message, pin: true });
  }

  return warnings;
}

/** Repositories whose servers must not start yet: a disaster recovery still re-seeds them from an external copy. */
export async function pendingReseedScopes(manager: DataSource | EntityManager): Promise<Set<string>> {
  const rows: { reseed: Record<string, string> }[] = await manager.query(
    `SELECT reseed FROM lw_dr_recoveries WHERE completed_at IS NULL`,
  );

  return new Set(
    rows.flatMap((r) =>
      Object.entries(r.reseed)
        .filter(([, state]) => state === 'pending')
        .map(([scope]) => scope),
    ),
  );
}
