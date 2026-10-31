import { hkdfSync } from 'node:crypto';

import { previousRun } from '@forepath/loadweaver/shared/util-scheduler';

import { PLATFORM_PREFIXES } from './s3-gateway.rules';

/** The kinds of control-plane data that are backed up (3.20). */
export const PLATFORM_BACKUP_KINDS = ['postgres', 'opensearch', 'etcd'] as const;
export type PlatformBackupKind = (typeof PLATFORM_BACKUP_KINDS)[number];

/** Catalog resource of each kind (`lw_backups.resource`). */
export function platformResource(kind: PlatformBackupKind): string {
  return `platform/${kind}`;
}

/** Default port of the members' S3 gateway (loopback); shared with the node agent's bootstrap. */
export {
  DEFAULT_GATEWAY_PORT,
  gatewayAccessKeyId,
  gatewaySecret,
} from '@forepath/loadweaver/shared/util-agent-protocol';
/** Ports of a point-in-time clone next to the member's own Postgres / Patroni. */
export const CLONE_PORTS = { pg: 5442, api: 8018 } as const;
/** OpenSearch repository name. */
export const OPENSEARCH_REPOSITORY = 'lw-platform';

function derive(key: string, label: string, bytes: number): Buffer {
  return Buffer.from(hkdfSync('sha256', Buffer.from(key, 'utf8'), Buffer.alloc(0), `loadweaver/${label}`, bytes));
}

/** The gateway's own Garage key for the platform bucket, per object-store generation. */
export function platformGarageKey(
  encryptionKey: string,
  generation: number,
): { accessKeyId: string; secretAccessKey: string } {
  return {
    accessKeyId: `GK${derive(encryptionKey, `garage/${generation}/platform-key-id`, 12).toString('hex')}`,
    secretAccessKey: derive(encryptionKey, `garage/${generation}/platform-key-secret`, 32).toString('hex'),
  };
}

/**
 * Whether a scheduled run is due: the newest cron time at or before `now` lies after the last start (missed runs
 * collapse into one, no catch-up storm). The first run of a fresh cluster waits for the first scheduled time.
 */
export function scheduledRunDue(
  schedule: string,
  timeZone: string,
  now: Date,
  lastStartedAt: Date | null,
  firstSeenAt: Date,
): Date | null {
  const after = lastStartedAt ?? firstSeenAt;
  const due = previousRun(schedule, timeZone, now, after);

  return due && due.getTime() > after.getTime() ? due : null;
}

export interface CatalogEntry {
  name: string;
  startedAt: Date;
}

/** Retention: keep the newest `keep` (by start time); returns the ones to delete, oldest first. */
export function retentionVictims<T extends CatalogEntry>(entries: readonly T[], keep: number): T[] {
  const sorted = [...entries].sort(
    (a, b) => b.startedAt.getTime() - a.startedAt.getTime() || (a.name < b.name ? 1 : -1),
  );

  return sorted.slice(Math.max(1, keep)).reverse();
}

export function walgPrefix(scope: string): string {
  return `${PLATFORM_PREFIXES.postgres}${scope}/wal/17/`;
}

export function openSearchBasePath(scope: string): string {
  return `${PLATFORM_PREFIXES.opensearch}${scope}`;
}

export function etcdPrefix(scope: string): string {
  return `${PLATFORM_PREFIXES.etcd}${scope}/`;
}

export function drEnvelopeKey(backup: string): string {
  return `${PLATFORM_PREFIXES.drEnvelope}${backup}.json`;
}

/** `20261019T101500Z`-style stamp for object / snapshot names. */
export function stamp(at: Date): string {
  return at
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

export function etcdSnapshotName(at: Date): string {
  return `etcd-${stamp(at).toLowerCase()}`;
}

export function openSearchSnapshotName(at: Date): string {
  return `lw-${stamp(at).toLowerCase()}`;
}

/** WAL-G base backup names: `base_<24 hex WAL name>` (+ `_D_<…>` for deltas). */
export const WALG_BACKUP_NAME = /^base_[0-9A-F]{24}(_D_[0-9A-F]{24})?$/;

/** The backup name in `wal-g backup-push` output ("Wrote backup with name base_…"). */
export function walgPushedBackup(output: string): string | null {
  const match = /Wrote backup with name (base_[0-9A-F]{24}(?:_D_[0-9A-F]{24})?)/.exec(output);

  return match ? match[1] : null;
}

/** Base backup names from the keys of `<prefix>basebackups_005/` (their stop sentinels). */
export function walgBackupsFromKeys(prefix: string, keys: readonly string[]): string[] {
  const base = `${prefix}basebackups_005/`;

  return keys
    .filter((k) => k.startsWith(base) && k.endsWith('_backup_stop_sentinel.json'))
    .map((k) => k.slice(base.length, -'_backup_stop_sentinel.json'.length))
    .filter((name) => WALG_BACKUP_NAME.test(name))
    .sort();
}

/** The WAL-G backup a key under `<prefix>basebackups_005/` belongs to (`<name>_backup_stop_sentinel.json`, `<name>/…`). */
export function walgKeyBackup(prefix: string, key: string): string | null {
  const base = `${prefix}basebackups_005/`;

  if (!key.startsWith(base)) return null;

  const rest = key.slice(base.length);
  const name = rest.endsWith('_backup_stop_sentinel.json')
    ? rest.slice(0, -'_backup_stop_sentinel.json'.length)
    : rest.split('/')[0];

  return WALG_BACKUP_NAME.test(name) ? name : null;
}

/** Log segment number (16 hex) of a WAL-G backup name (its start segment). */
function walgBackupSegment(name: string): string {
  return name.slice('base_'.length + 8, 'base_'.length + 24);
}

/**
 * The exact keys `wal-g delete before FIND_FULL <target>` may remove (M6 review L4): the objects of the victim
 * backups and the WAL segments whose log segment number lies before the target's start segment (timeline history
 * files stay). The retention grant names only these keys, so a member's gateway refuses every other delete.
 */
export function walgRetentionKeys(
  prefix: string,
  keys: readonly string[],
  victims: readonly string[],
  target: string,
): string[] {
  const doomed = new Set(victims);
  const bound = walgBackupSegment(target);
  const wal = `${prefix}wal_005/`;

  return keys.filter((key) => {
    const backup = walgKeyBackup(prefix, key);

    if (backup !== null) return doomed.has(backup);

    if (!key.startsWith(wal)) return false;

    const segment = /^[0-9A-F]{8}([0-9A-F]{16})/.exec(key.slice(wal.length));

    return segment !== null && segment[1] < bound;
  });
}

/** The exact keys `wal-g delete target <name>` may remove: the backup's objects and those of newer delta backups. */
export function walgTargetKeys(prefix: string, keys: readonly string[], name: string): string[] {
  const from = walgBackupSegment(name);

  return keys.filter((key) => {
    const backup = walgKeyBackup(prefix, key);

    return backup !== null && (backup === name || (backup.includes('_D_') && walgBackupSegment(backup) > from));
  });
}

/** Scope of a point-in-time clone: the cluster's scope plus a short restore id (Patroni scope rules, ≤ 63). */
export function cloneScope(scope: string, restoreId: string): string {
  const suffix = `-r${restoreId.replace(/[^a-z0-9]/g, '').slice(0, 8)}`;

  return `${scope.slice(0, 63 - suffix.length).replace(/-+$/, '')}${suffix}`;
}

/** Recovery target as Spilo / Postgres want it: with an explicit offset. */
export function recoveryTargetTime(at: Date): string {
  return at.toISOString().replace('T', ' ').replace('Z', '+00:00');
}

/** A data directory path safe to put into a shell command (Spilo: `/home/postgres/pgdata/pgroot/data`). */
export function safeDataDirectory(path: string): boolean {
  return /^\/[A-Za-z0-9/_.-]{1,255}$/.test(path) && !path.split('/').includes('..');
}

/**
 * Shell command run in the leader's Spilo container (through `COPY … FROM PROGRAM` as the database superuser) with
 * WAL-G's environment: the output and the exit code come back as rows.
 */
export function walgCommand(args: string, dataDirectory?: string): string {
  if (dataDirectory !== undefined && !safeDataDirectory(dataDirectory)) throw new Error('unsafe data directory');

  return `bash -c 'export PGHOST=/var/run/postgresql; envdir /run/etc/wal-e.d/env nice -n 5 wal-g ${args}${
    dataDirectory ? ` ${dataDirectory}` : ''
  } 2>&1 | tail -c 16000; echo "LW_EXIT=\${PIPESTATUS[0]}"'`;
}

/** Splits COPY output lines into the program's output and its exit code. */
export function walgResult(lines: readonly string[]): { exitCode: number; output: string } {
  const last = [...lines].reverse().find((l) => l.startsWith('LW_EXIT='));
  const exitCode = last ? Number(last.slice('LW_EXIT='.length)) : -1;

  return { exitCode: Number.isInteger(exitCode) ? exitCode : -1, output: lines.filter((l) => l !== last).join('\n') };
}
