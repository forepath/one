import { open, seal } from '@forepath/loadweaver/shared/util-secrets';
import { Injectable } from '@nestjs/common';

import { ClusterIdentityService } from '../services/cluster-identity.service';
import { MasterKeyService } from '../services/master-key.service';
import { BackupKeyService } from './backup-keys.service';
import { backupDataKey } from './backup-keys.utils';

/**
 * DR envelope (3.20, M6 decision): the master key plus the control-plane environment needed for a whole-cluster
 * restore, encrypted under the backup key and stored with every control-plane backup. The recovery kit (or the
 * KMS escrow) unlocks it, so a restore brings back secrets, the cluster CA and identities. Never logged.
 */

/**
 * Environment variables the envelope carries (only what a restore needs; everything else is configuration that
 * the installer recreates):
 * - `ENCRYPTION_KEY`: column encryption (cluster CA private key, provider tokens, ...);
 * - `JWT_SECRET`: user sessions / PATs stay valid (users mode);
 * - `STATIC_API_KEY`: api-key mode;
 * - `DB_USERNAME`, `DB_PASSWORD`, `LOADWEAVER_POSTGRES_ADMIN_PASSWORD`, `LOADWEAVER_POSTGRES_REPLICATION_PASSWORD`:
 *   the restored Postgres cluster keeps its roles;
 * - `KEYCLOAK_CLIENT_SECRET`: keycloak mode;
 * - `REDIS_PASSWORD`: queue;
 * - `LOADWEAVER_MASTER_KEY_KMS`, `LOADWEAVER_VAULT_TRANSIT_KEY`: which KMS held the master key (the KMS
 *   credentials themselves are not stored).
 */
export const DR_ENVELOPE_ENV_KEYS = [
  'ENCRYPTION_KEY',
  'JWT_SECRET',
  'STATIC_API_KEY',
  'DB_USERNAME',
  'DB_PASSWORD',
  'LOADWEAVER_POSTGRES_ADMIN_PASSWORD',
  'LOADWEAVER_POSTGRES_REPLICATION_PASSWORD',
  'KEYCLOAK_CLIENT_SECRET',
  'REDIS_PASSWORD',
  'LOADWEAVER_MASTER_KEY_KMS',
  'LOADWEAVER_VAULT_TRANSIT_KEY',
  // Configuration a restored control plane starts with (not secret, but not recreated by the installer, 3c).
  'DB_DATABASE',
  'AUTHENTICATION_METHOD',
  'KEYCLOAK_SERVER_URL',
  'KEYCLOAK_AUTH_SERVER_URL',
  'KEYCLOAK_REALM',
  'KEYCLOAK_CLIENT_ID',
  'CORS_ORIGIN',
  'LOADWEAVER_CLUSTER_NAME',
  'LOADWEAVER_PUBLIC_URL',
  'DYNAMIC_KMS_PROVIDERS',
  'VAULT_ADDR',
  'VAULT_NAMESPACE',
  'LOADWEAVER_VAULT_TRANSIT_MOUNT',
] as const;

export const DR_ENVELOPE_FORMAT = 'loadweaver-dr-envelope';

export interface DrEnvelopeContents {
  masterKey: { id: string; value: Buffer };
  env: Partial<Record<(typeof DR_ENVELOPE_ENV_KEYS)[number], string>>;
  /** Cluster CA (certificate + private key), node / workload identities are issued from it. */
  cluster: { clusterId: string; caCertificate: string; caPrivateKey: string } | null;
  /**
   * The backup this envelope was stored with (3c): a fresh node picks the newest Postgres base backup by it and finds
   * its WAL under `spilo/<postgresScope>/`. Absent in envelopes written before.
   */
  backup?: DrEnvelopeBackup;
}

export interface DrEnvelopeBackup {
  kind: 'postgres' | 'opensearch' | 'etcd';
  name: string;
  postgresScope: string;
  finishedAt: string;
}

/** Stored next to every control-plane backup; only `sealed` is secret (and encrypted). */
export interface DrEnvelope {
  format: typeof DR_ENVELOPE_FORMAT;
  version: 1;
  generation: number;
  createdAt: string;
  /** base64 `seal(dataKey(generation), payload, aad)`. */
  sealed: string;
}

function aadOf(generation: number, createdAt: string): string {
  return `${DR_ENVELOPE_FORMAT}/1/${generation}/${createdAt}`;
}

/** Picks the listed variables from an environment (missing ones are left out). */
export function drEnvironment(env: NodeJS.ProcessEnv = process.env): DrEnvelopeContents['env'] {
  return Object.fromEntries(
    DR_ENVELOPE_ENV_KEYS.filter((k) => typeof env[k] === 'string' && env[k] !== '').map((k) => [k, env[k] as string]),
  );
}

export async function sealDrEnvelope(
  keys: Pick<BackupKeyService, 'current'>,
  contents: DrEnvelopeContents,
  now = new Date(),
): Promise<DrEnvelope> {
  const { generation, key } = await keys.current();
  const createdAt = now.toISOString();
  const payload = Buffer.from(
    JSON.stringify({
      masterKey: { id: contents.masterKey.id, value: contents.masterKey.value.toString('base64') },
      env: contents.env,
      cluster: contents.cluster,
      ...(contents.backup ? { backup: contents.backup } : {}),
    }),
    'utf8',
  );

  try {
    return {
      format: DR_ENVELOPE_FORMAT,
      version: 1,
      generation,
      createdAt,
      sealed: seal(key, payload, aadOf(generation, createdAt)).toString('base64'),
    };
  } finally {
    payload.fill(0);
  }
}

/**
 * Opens an envelope with the backup key service (running cluster), a data key, or the root key recovered from
 * the kit / KMS (`{ root }`, fresh node).
 */
export async function openDrEnvelope(
  envelope: DrEnvelope,
  key: Pick<BackupKeyService, 'forGeneration'> | { dataKey: Buffer } | { root: Buffer },
): Promise<DrEnvelopeContents> {
  if (envelope.format !== DR_ENVELOPE_FORMAT || envelope.version !== 1) throw new Error('not a DR envelope');

  const dataKey =
    'dataKey' in key
      ? key.dataKey
      : 'root' in key
        ? backupDataKey(key.root, envelope.generation)
        : await key.forGeneration(envelope.generation);
  let payload: Buffer;

  try {
    payload = open(dataKey, Buffer.from(envelope.sealed, 'base64'), aadOf(envelope.generation, envelope.createdAt));
  } catch {
    throw new Error('the DR envelope cannot be opened with this backup key');
  }

  try {
    const parsed = JSON.parse(payload.toString('utf8')) as {
      masterKey: { id: string; value: string };
      env: DrEnvelopeContents['env'];
      cluster: DrEnvelopeContents['cluster'];
      backup?: DrEnvelopeBackup;
    };

    return {
      masterKey: { id: parsed.masterKey.id, value: Buffer.from(parsed.masterKey.value, 'base64') },
      env: parsed.env,
      cluster: parsed.cluster,
      ...(parsed.backup ? { backup: parsed.backup } : {}),
    };
  } finally {
    payload.fill(0);
  }
}

/** Gathers the contents on a running control plane and seals them (used with every control-plane backup). */
@Injectable()
export class DrEnvelopeService {
  constructor(
    private readonly keys: BackupKeyService,
    private readonly masterKey: MasterKeyService,
    private readonly identity: ClusterIdentityService,
  ) {}

  async seal(env: NodeJS.ProcessEnv = process.env, backup?: DrEnvelopeBackup): Promise<DrEnvelope> {
    const master = await this.masterKey.current();
    const cluster = await this.identity.cluster().catch(() => null);

    return await sealDrEnvelope(this.keys, {
      masterKey: master,
      env: drEnvironment(env),
      cluster: cluster
        ? { clusterId: cluster.clusterId, caCertificate: cluster.caCertificate, caPrivateKey: cluster.caPrivateKey }
        : null,
      ...(backup ? { backup } : {}),
    });
  }

  async open(envelope: DrEnvelope): Promise<DrEnvelopeContents> {
    return await openDrEnvelope(envelope, this.keys);
  }
}
