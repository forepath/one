import { BACKUP_SERVER_PORTS, type BackupServerRole } from '@forepath/loadweaver/shared/util-agent-protocol';
import { ServiceUnavailableException } from '@nestjs/common';

import type { NodeEntity } from '../entities/node.entity';
import type { ObjectStoreGenerationEntity } from '../entities/object-store-generation.entity';
import { BACKUPS_BUCKET, objectStorePorts } from '../object-store/object-store.utils';
import type { BackupRepositoryEntity } from './backup.entities';

export type BackupServerNode = Pick<NodeEntity, 'name' | 'overlayV4' | 'overlayV6'>;
type Generation = Pick<ObjectStoreGenerationEntity, 'generation' | 'state' | 'holders'>;

export function overlay(node: BackupServerNode): string | null {
  return node.overlayV4 ?? node.overlayV6 ?? null;
}

/**
 * The repository servers a control-plane member runs (desired state `backupServer`, 3.20): every repository, stored
 * under `<scope>/` in the active generation's backups bucket. Secrets are added at push time (`withServerSecrets`).
 */
export function backupServerRole(
  node: BackupServerNode,
  members: ReadonlySet<string>,
  nodes: readonly BackupServerNode[],
  generations: readonly Generation[],
  repositories: ReadonlyArray<Pick<BackupRepositoryEntity, 'scope' | 'port' | 'certificate'>>,
): BackupServerRole | undefined {
  const active = generations.find((g) => g.state === 'active');

  if (!members.has(node.name) || !active || repositories.length === 0) return undefined;

  const s3Node = active.holders.includes(node.name)
    ? node
    : nodes.find((n) => active.holders.includes(n.name) && overlay(n));
  const address = s3Node ? overlay(s3Node) : null;

  if (!address) return undefined;

  return {
    repositories: [...repositories]
      .sort((a, b) => a.scope.localeCompare(b.scope))
      .map((r) => ({
        scope: r.scope,
        port: r.port,
        s3: {
          address,
          port: objectStorePorts(active.generation).s3,
          bucket: BACKUPS_BUCKET,
          prefix: `${r.scope}/`,
        },
        tls: { certificatePem: r.certificate },
      })),
  };
}

/** Lowest free port of the repository-server range. */
export function freeBackupPort(used: readonly number[]): number {
  const taken = new Set(used);

  for (let port = BACKUP_SERVER_PORTS.from; port <= BACKUP_SERVER_PORTS.to; port++) if (!taken.has(port)) return port;

  throw new ServiceUnavailableException('no free backup repository port (256 repositories at most)');
}
