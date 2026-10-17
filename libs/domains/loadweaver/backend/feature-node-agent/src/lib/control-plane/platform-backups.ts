import { createHash } from 'node:crypto';

import type { ControlPlaneRole, PlatformBackupsRole } from '@forepath/loadweaver/shared/util-agent-protocol';

import type { ContainerSpec, MemberContext } from './control-plane-containers';
import { spiloTlsEnvironment } from './postgres-tls';

/**
 * Control-plane data backups on a member (3.20): settings for WAL-G in Spilo and the OpenSearch snapshot repository.
 * Both write through the S3 gateway of the member's own control-plane API on loopback, with the member's gateway
 * credentials (never the Garage keys); schedules, retention and the catalog are the control plane's.
 */

export const POSTGRES_CLONE_CONTAINER = 'lw-postgres-pitr';
export const POSTGRES_CLONE_COMPONENT = 'postgres-pitr';
/** Spilo's cron line for its own backup script: 31 February never comes (base backups are the control plane's). */
export const SPILO_BACKUP_SCHEDULE_NEVER = '0 0 31 2 *';
/** Spilo's own retention (`postgres_backup.sh`) never deletes with this many backups to retain. */
export const SPILO_RETAIN_NEVER = '1000000';
/** Seconds one archive fetch (`restore_command`) may take before Postgres moves on (Spilo's `WAL_RESTORE_TIMEOUT`). */
export const SPILO_WAL_RESTORE_TIMEOUT_SECONDS = '10';

export function gatewayEndpoint(backups: PlatformBackupsRole): string {
  return `http://127.0.0.1:${backups.gatewayPort}`;
}

/**
 * WAL-G environment for Spilo (M6 spike settings): continuous WAL archiving to
 * `s3://<bucket>/spilo/<scope>/wal/17`, no overwrite of an existing segment, no SSE (Garage), path-style; Spilo's
 * scheduled backup / retention script is disabled. Empty without credentials (an older control plane, or the
 * secret wasn't added).
 */
export function spiloBackupEnvironment(role: ControlPlaneRole): Record<string, string> {
  const backups = role.platformBackups;
  const credential = backups?.postgres;

  if (!backups || !credential?.secretAccessKey) return {};

  return {
    USE_WALG_BACKUP: 'true',
    USE_WALG_RESTORE: 'true',
    WAL_S3_BUCKET: backups.bucket,
    AWS_ENDPOINT: gatewayEndpoint(backups),
    AWS_REGION: backups.region,
    AWS_S3_FORCE_PATH_STYLE: 'true',
    AWS_ACCESS_KEY_ID: credential.accessKeyId,
    AWS_SECRET_ACCESS_KEY: credential.secretAccessKey,
    WALG_DISABLE_S3_SSE: 'true',
    // A re-pushed segment with the same content is skipped, a different one fails (the gateway refuses it anyway).
    WALG_PREVENT_WAL_OVERWRITE: 'true',
    BACKUP_SCHEDULE: SPILO_BACKUP_SCHEDULE_NEVER,
    BACKUP_NUM_TO_RETAIN: SPILO_RETAIN_NEVER,
    // The archive is read through the member's own API (gateway): while the API waits for this database (a restart of
    // the only member, found in the DR drill), an unbounded `wal-fetch` would block Postgres' startup forever. Bounded,
    // a failed fetch falls back to the local WAL and streaming, as Postgres does for a missing archive file.
    WAL_RESTORE_TIMEOUT: SPILO_WAL_RESTORE_TIMEOUT_SECONDS,
  };
}

/**
 * Point-in-time clone of the control-plane database into its own Patroni scope (3.20 "point-in-time for the
 * control plane"), side by side with the running cluster on this member: Spilo's `CLONE_WITH_WALE` bootstrap picks
 * the newest base backup before the target time and replays WAL up to it, then promotes. The clone archives its own
 * WAL under its own scope, so a later cut-over keeps point-in-time recovery. Ports differ from the main member's.
 */
export function postgresCloneSpec(
  ctx: MemberContext,
  role: ControlPlaneRole,
  dataDir: string,
  /** `ETCD3_HOSTS` of the member's own Spilo: the clone keeps its scope in the same etcd. */
  etcdHosts: string,
): ContainerSpec | null {
  const backups = role.platformBackups;
  const clone = backups?.postgresClone;
  const credential = backups?.postgres;

  if (!backups || !clone || !credential?.secretAccessKey) return null;

  const env = role.environment ?? {};
  const archive = spiloBackupEnvironment(role);
  const containerEnv: Record<string, string> = {
    SCOPE: clone.scope,
    PGVERSION: '17',
    PGPORT: String(clone.pgPort),
    APIPORT: String(clone.apiPort),
    SPILO_PROVIDER: 'local',
    ETCD3_HOSTS: etcdHosts,
    ETCD3_PROTOCOL: 'http',
    POD_IP: ctx.address,
    PGUSER_SUPERUSER: env['DB_USERNAME'] || 'postgres',
    PGPASSWORD_SUPERUSER: env['DB_PASSWORD'] ?? '',
    PGPASSWORD_STANDBY: env['LOADWEAVER_POSTGRES_REPLICATION_PASSWORD'] ?? '',
    PGPASSWORD_ADMIN: env['LOADWEAVER_POSTGRES_ADMIN_PASSWORD'] ?? '',
    PGROOT: '/home/postgres/pgdata/pgroot',
    ...spiloTlsEnvironment(ctx.postgresTls),
    ...archive,
    CLONE_SCOPE: clone.sourceScope,
    CLONE_METHOD: 'CLONE_WITH_WALE',
    CLONE_USE_WALG_RESTORE: 'true',
    CLONE_WAL_S3_BUCKET: backups.bucket,
    CLONE_AWS_ACCESS_KEY_ID: credential.accessKeyId,
    CLONE_AWS_SECRET_ACCESS_KEY: credential.secretAccessKey,
    CLONE_AWS_ENDPOINT: gatewayEndpoint(backups),
    CLONE_AWS_REGION: backups.region,
    CLONE_AWS_S3_FORCE_PATH_STYLE: 'true',
    ...(clone.targetTime ? { CLONE_TARGET_TIME: clone.targetTime } : {}),
  };

  return {
    name: POSTGRES_CLONE_CONTAINER,
    image: ctx.images.postgres,
    env: containerEnv,
    binds: [`${dataDir}:/home/postgres/pgdata`],
    memoryBytes: 1024 ** 3,
    component: 'postgres',
    hash: createHash('sha256')
      .update(JSON.stringify({ image: ctx.images.postgres, containerEnv }))
      .digest('hex')
      .slice(0, 16),
  };
}

/** Keystore entries of the default S3 client, read by OpenSearch's `repository-s3` plugin. */
const OPENSEARCH_KEYSTORE_SCRIPT = [
  'set -e',
  // Images without the plugin (development pins) run unchanged; the control plane reports snapshots as unavailable.
  'if [ -d plugins/repository-s3 ]; then',
  '  [ -f config/opensearch.keystore ] || bin/opensearch-keystore create >/dev/null',
  '  printf %s "$LW_BACKUP_S3_ACCESS_KEY" | bin/opensearch-keystore add --stdin --force s3.client.default.access_key >/dev/null',
  '  printf %s "$LW_BACKUP_S3_SECRET_KEY" | bin/opensearch-keystore add --stdin --force s3.client.default.secret_key >/dev/null',
  '  unset LW_BACKUP_S3_ACCESS_KEY LW_BACKUP_S3_SECRET_KEY',
  '  exec env "s3.client.default.endpoint=$LW_BACKUP_S3_ENDPOINT" s3.client.default.protocol=http \\',
  '    s3.client.default.path_style_access=true "s3.client.default.region=$LW_BACKUP_S3_REGION" \\',
  '    ./opensearch-docker-entrypoint.sh opensearch',
  'fi',
  'unset LW_BACKUP_S3_ACCESS_KEY LW_BACKUP_S3_SECRET_KEY',
  'exec ./opensearch-docker-entrypoint.sh opensearch',
].join('\n');

/**
 * OpenSearch snapshot repository client (M6 spike): keystore keys + `s3.client.default.*` node settings pointing at
 * the member's gateway. Applied by a start script, so images without `repository-s3` still start.
 */
export function openSearchBackupSettings(
  role: ControlPlaneRole,
): { cmd: string[]; env: Record<string, string> } | null {
  const backups = role.platformBackups;
  const credential = backups?.opensearch;

  if (!backups || !credential?.secretAccessKey) return null;

  return {
    cmd: ['bash', '-c', OPENSEARCH_KEYSTORE_SCRIPT],
    env: {
      LW_BACKUP_S3_ACCESS_KEY: credential.accessKeyId,
      LW_BACKUP_S3_SECRET_KEY: credential.secretAccessKey,
      LW_BACKUP_S3_ENDPOINT: `127.0.0.1:${backups.gatewayPort}`,
      LW_BACKUP_S3_REGION: backups.region,
    },
  };
}

/** Where the API's S3 gateway listens on a member (loopback only: its clients run on the same member). */
export function gatewayListenEnvironment(role: ControlPlaneRole): Record<string, string> {
  return role.platformBackups
    ? { LOADWEAVER_BACKUP_GATEWAY_LISTEN: `127.0.0.1:${role.platformBackups.gatewayPort}` }
    : {};
}
