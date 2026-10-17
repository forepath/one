import type { ControlPlaneRole, PlatformBackupsRole } from '@forepath/loadweaver/shared/util-agent-protocol';
import { platformBackupSettings, type ClusterBackups } from '@forepath/loadweaver/shared/util-model';
import type { EntityManager } from 'typeorm';
import { In } from 'typeorm';

import { PlatformRestoreEntity } from './platform-backups.entities';
import { PlatformCutoverEntity } from './platform-dr.entities';
import {
  CLONE_PORTS,
  DEFAULT_GATEWAY_PORT,
  gatewayAccessKeyId,
  gatewaySecret,
  recoveryTargetTime,
} from './platform-backups.utils';
import { GATEWAY_REGION, PLATFORM_BUCKET } from './s3-gateway.rules';

/** The point-in-time restore members should run (requested / restoring / ready), if any. */
export async function activePlatformRestore(manager: EntityManager): Promise<PlatformRestoreEntity | null> {
  return await manager
    .getRepository(PlatformRestoreEntity)
    .findOne({ where: { kind: 'postgres', state: In(['requested', 'restoring', 'ready']) } });
}

/** What the members' desired state needs of the platform backups: the clone, a running cut-over, the database scope. */
export interface PlatformState {
  restore: PlatformRestoreEntity | null;
  /** A cut-over that is switching right now (members act on it). */
  cutover: PlatformCutoverEntity | null;
  /** Database scope after the latest cut-over, or null (= the cluster id). */
  postgresScope: string | null;
}

export async function activePlatformState(manager: EntityManager): Promise<PlatformState> {
  const latest = await manager
    .getRepository(PlatformCutoverEntity)
    .findOne({ where: { state: In(['switching', 'done']) }, order: { createdAt: 'DESC' } });

  return {
    restore: await activePlatformRestore(manager),
    cutover: latest?.state === 'switching' ? latest : null,
    postgresScope: latest?.scope ?? null,
  };
}

/**
 * The member's control-plane role with its platform-backup settings (3.20): `platformBackups` (gated by
 * `platform-backups`), the database scope after a cut-over and the cut-over itself (gated by `platform-cutover`).
 */
export function withPlatformState(
  role: ControlPlaneRole,
  node: string,
  backups: ClusterBackups | undefined,
  state: PlatformState,
  env: NodeJS.ProcessEnv = process.env,
): ControlPlaneRole {
  const platformBackups = platformBackupsRole(node, role.role, backups, state.restore, env, state.cutover);

  return {
    ...role,
    ...(role.role === 'member' && state.postgresScope && state.postgresScope !== role.scope
      ? { postgresScope: state.postgresScope }
      : {}),
    ...(platformBackups ? { platformBackups } : {}),
  };
}

/**
 * `controlPlane.platformBackups` of a member's desired state (3.20): gateway port, bucket, the member's client key
 * ids (secrets are added at push time), and the point-in-time clone if this member runs it. Nothing without the
 * encryption key or with platform backups disabled.
 */
export function platformBackupsRole(
  node: string,
  role: 'none' | 'member' | 'witness',
  backups: ClusterBackups | undefined,
  restore: PlatformRestoreEntity | null,
  env: NodeJS.ProcessEnv = process.env,
  cutover: PlatformCutoverEntity | null = null,
): PlatformBackupsRole | undefined {
  const key = env['ENCRYPTION_KEY'];

  if (role !== 'member' || !key || !platformBackupSettings(backups).enabled) return undefined;

  const port = Number(env['LOADWEAVER_BACKUP_GATEWAY_PORT'] ?? DEFAULT_GATEWAY_PORT);

  return {
    gatewayPort: Number.isInteger(port) && port >= 1024 && port < 65536 ? port : DEFAULT_GATEWAY_PORT,
    bucket: PLATFORM_BUCKET,
    region: GATEWAY_REGION,
    postgres: { accessKeyId: gatewayAccessKeyId(key, 'postgres', node) },
    opensearch: { accessKeyId: gatewayAccessKeyId(key, 'opensearch', node) },
    ...(restore && restore.node === node && restore.scope !== 'pending'
      ? {
          postgresClone: {
            id: restore.id,
            scope: restore.scope,
            sourceScope: restore.sourceScope,
            targetTime: restore.targetTime ? recoveryTargetTime(restore.targetTime) : '',
            pgPort: CLONE_PORTS.pg,
            apiPort: CLONE_PORTS.api,
          },
        }
      : {}),
    ...(cutover
      ? {
          postgresCutover: {
            id: cutover.restoreId,
            scope: cutover.scope,
            previousScope: cutover.previousScope,
            node: cutover.node,
          },
        }
      : {}),
  };
}

/** Adds the gateway secrets at push time (never persisted in desired-state rows, 3.22). */
export function withPlatformBackupSecrets(backups: PlatformBackupsRole, encryptionKey: string): PlatformBackupsRole {
  const secret = (credential: PlatformBackupsRole['postgres']) =>
    credential ? { ...credential, secretAccessKey: gatewaySecret(encryptionKey, credential.accessKeyId) } : undefined;

  return {
    ...backups,
    ...(backups.postgres ? { postgres: secret(backups.postgres) } : {}),
    ...(backups.opensearch ? { opensearch: secret(backups.opensearch) } : {}),
  };
}
