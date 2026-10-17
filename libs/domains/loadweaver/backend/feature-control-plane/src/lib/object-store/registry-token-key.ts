import { createCertificateAuthority } from '@forepath/loadweaver/shared/util-pki';
import type { EntityManager } from 'typeorm';

import { ClusterEntity } from '../entities/cluster.entity';

const ADVISORY_LOCK_REGISTRY_TOKEN_KEY = 0x4c570009;
const TOKEN_KEY_VALIDITY_DAYS = 3650;

export interface RegistryTokenKey {
  certificatePem: string;
  privateKeyPem: string;
}

/**
 * The cluster's registry-token key (3.22), created once. Its self-signed certificate is the registry's only trust
 * root; the cluster CA (which also issues node identities) is deliberately not trusted by the registry.
 */
export async function ensureRegistryTokenKey(manager: EntityManager): Promise<RegistryTokenKey> {
  await manager.query('SELECT pg_advisory_xact_lock($1)', [ADVISORY_LOCK_REGISTRY_TOKEN_KEY]);

  const repo = manager.getRepository(ClusterEntity);
  const cluster = await repo.findOneOrFail({ where: {} });

  if (cluster.registryTokenCertificate && cluster.registryTokenPrivateKey) {
    return { certificatePem: cluster.registryTokenCertificate, privateKeyPem: cluster.registryTokenPrivateKey };
  }

  const created = await createCertificateAuthority({
    commonName: `${cluster.clusterId} registry tokens`,
    validityDays: TOKEN_KEY_VALIDITY_DAYS,
  });

  await repo.update(
    { id: cluster.id },
    { registryTokenCertificate: created.certificatePem, registryTokenPrivateKey: created.privateKeyPem },
  );

  return created;
}
