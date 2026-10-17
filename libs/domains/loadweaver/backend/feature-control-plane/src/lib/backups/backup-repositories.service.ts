import {
  KOPIA_CONTROL_USER,
  volumeBackupUser,
  type BackupRepositoryServer,
  type BackupServerRole,
  type KopiaRepositoryAccess,
} from '@forepath/loadweaver/shared/util-agent-protocol';
import { createCsr, generateKeyPair, issueCertificate } from '@forepath/loadweaver/shared/util-pki';
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, type EntityManager } from 'typeorm';

import { ClusterEntity } from '../entities/cluster.entity';
import { ObjectStoreGenerationEntity } from '../entities/object-store-generation.entity';
import { BACKUPS_BUCKET, objectStoreSecrets } from '../object-store/object-store.utils';
import { NetworkStateService } from '../services/network-state.service';
import { freeBackupPort, overlay, type BackupServerNode } from './backup-server-role';
import { BackupRepositoryEntity } from './backup.entities';
import { BackupKeyService } from './backup-keys.service';
import { repositoryPassword, repositoryUserPassword } from './backup-keys.utils';
import { KopiaCli, type KopiaConnection } from './kopia-cli';

const ADVISORY_LOCK_BACKUP_REPOSITORIES = 0x4c570021;
/** Repository server certificates: pinned by fingerprint, so long-lived (rotation = new fingerprint per command). */
const SERVER_CERTIFICATE_VALIDITY_HOURS = 5 * 365 * 24;
export const SERVER_CONTROL_USER = 'server-control';

/**
 * Kopia repositories (one per trust boundary) and their servers on the control-plane members (3.20): creates the
 * repository records (port, TLS certificate from the cluster CA, the backup-key generation their passwords derive
 * from), adds secrets to the members' desired state at push time, manages the Kopia users of volumes and hands out
 * the access a node needs for one command. The control plane's own access is FULL.
 */
@Injectable()
export class BackupRepositoriesService {
  private readonly logger = new Logger(BackupRepositoriesService.name);
  private readonly kopia: KopiaCli;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly keys: BackupKeyService,
    private readonly network: NetworkStateService,
  ) {
    this.kopia = this.createKopia();
  }

  /** Overridable for tests. */
  protected createKopia(): KopiaCli {
    return new KopiaCli();
  }

  get cli(): KopiaCli {
    return this.kopia;
  }

  /** Where the control plane reaches a member's repository server (the overlay; overridable for tests). */
  protected serverEndpoints(
    repository: Pick<BackupRepositoryEntity, 'port'>,
    members: BackupServerNode[],
  ): Array<{ address: string; port: number }> {
    return members.flatMap((m) => {
      const address = overlay(m);

      return address ? [{ address, port: repository.port }] : [];
    });
  }

  async get(scope: string): Promise<BackupRepositoryEntity | null> {
    return await this.dataSource.getRepository(BackupRepositoryEntity).findOne({ where: { scope } });
  }

  async list(): Promise<BackupRepositoryEntity[]> {
    return await this.dataSource.getRepository(BackupRepositoryEntity).find({ order: { scope: 'ASC' } });
  }

  /** The repository of a scope, created (and the members' desired state recompiled) on first use. */
  async ensure(scope: string): Promise<BackupRepositoryEntity> {
    const existing = await this.get(scope);

    if (existing) return existing;

    const created = await this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock($1)', [ADVISORY_LOCK_BACKUP_REPOSITORIES]);

      const repo = manager.getRepository(BackupRepositoryEntity);
      const again = await repo.findOne({ where: { scope } });

      if (again) return { row: again, created: false };

      const { generation } = await this.keys.current();
      const used = (await repo.find({ select: { port: true } })).map((r) => r.port);
      const tls = await this.issueCertificate(manager, scope);

      return {
        row: await repo.save(
          repo.create({
            scope,
            port: freeBackupPort(used),
            keyGeneration: generation,
            certificate: tls.certificatePem,
            privateKey: tls.privateKeyPem,
            fingerprint: tls.fingerprint,
            users: [],
            readyAt: null,
          }),
        ),
        created: true,
      };
    });

    if (created.created) {
      this.logger.log(`Backup repository ${scope} created on port ${created.row.port}`);
      await this.network.recompile();
    }

    return created.row;
  }

  private async issueCertificate(
    manager: EntityManager,
    scope: string,
  ): Promise<{ certificatePem: string; privateKeyPem: string; fingerprint: string }> {
    const cluster = await manager.getRepository(ClusterEntity).findOneOrFail({ where: {} });
    const keys = await generateKeyPair();
    const issued = await issueCertificate({
      ca: { certificatePem: cluster.caCertificate, privateKeyPem: cluster.caPrivateKey },
      csrPem: await createCsr(keys, `backup-${scope}`),
      clusterId: cluster.clusterId,
      kind: 'control-plane',
      name: `backup-${scope}`,
      dnsNames: [`backup-${scope}.loadweaver`],
      validityHours: SERVER_CERTIFICATE_VALIDITY_HOURS,
    });

    return {
      certificatePem: issued.certificatePem,
      privateKeyPem: keys.privateKeyPem,
      fingerprint: issued.fingerprintSha256,
    };
  }

  /** Secrets of the members' repository servers, added at push time only (never stored in desired state). */
  async withServerSecrets(role: BackupServerRole, env: NodeJS.ProcessEnv = process.env): Promise<BackupServerRole> {
    const encryptionKey = env['ENCRYPTION_KEY'];

    if (!encryptionKey) return role;

    const rows = new Map((await this.list()).map((r) => [r.scope, r]));
    const active = await this.dataSource
      .getRepository(ObjectStoreGenerationEntity)
      .findOne({ where: { state: 'active' } });
    const repositories: BackupRepositoryServer[] = [];

    if (!active) return role;

    for (const server of role.repositories) {
      const row = rows.get(server.scope);

      if (!row) continue;

      const dataKey = await this.keys.forGeneration(row.keyGeneration);
      const s3 = objectStoreSecrets(encryptionKey, active.generation);

      repositories.push({
        ...server,
        tls: { certificatePem: row.certificate, privateKeyPem: row.privateKey },
        accessKeyId: s3.backupsAccessKeyId,
        secretAccessKey: s3.backupsSecretAccessKey,
        password: repositoryPassword(dataKey, row.scope),
        controlPassword: repositoryUserPassword(dataKey, row.scope, controlUser()),
        serverControlPassword: repositoryUserPassword(dataKey, row.scope, SERVER_CONTROL_USER),
      });
    }

    return { repositories };
  }

  private async members(): Promise<BackupServerNode[]> {
    return (await this.dataSource.query(
      `SELECT name, overlay_v4 AS "overlayV4", overlay_v6 AS "overlayV6" FROM lw_nodes
       WHERE control_plane = true AND witness = false AND lifecycle <> 'left' ORDER BY name`,
    )) as BackupServerNode[];
  }

  /** The control plane's FULL connection to a repository through its servers. */
  async controlConnection(scope: string): Promise<KopiaConnection & { kind: 'server' }> {
    const row = await this.get(scope);

    if (!row) throw new ServiceUnavailableException(`backup repository ${scope} does not exist yet`);

    const servers = this.serverEndpoints(row, await this.members());

    if (!servers.length) throw new ServiceUnavailableException('no repository server reachable');

    const dataKey = await this.keys.forGeneration(row.keyGeneration);

    return {
      kind: 'server',
      servers,
      fingerprint: row.fingerprint,
      username: KOPIA_CONTROL_USER.username,
      hostname: KOPIA_CONTROL_USER.hostname,
      password: repositoryUserPassword(dataKey, scope, controlUser()),
    };
  }

  /**
   * The access a node gets for one command on a volume: the volume's own Kopia user (APPEND / READ on its own
   * snapshots), created on the servers the first time.
   */
  async volumeAccess(scope: string, volumeId: string): Promise<KopiaRepositoryAccess> {
    const row = await this.ensure(scope);
    const user = volumeBackupUser(volumeId);
    const name = `${user.username}@${user.hostname}`;
    const dataKey = await this.keys.forGeneration(row.keyGeneration);
    const password = repositoryUserPassword(dataKey, scope, name);
    const servers = this.serverEndpoints(row, await this.members());

    if (!servers.length) throw new ServiceUnavailableException('no repository server reachable');

    if (!row.users.includes(name)) {
      const control = await this.controlConnection(scope);

      await this.kopia.ensureUser(control, name, password);

      // Running servers pick new users up after a refresh (otherwise within minutes).
      for (const server of servers)
        await this.kopia
          .refreshServer(server, row.fingerprint, repositoryUserPassword(dataKey, scope, SERVER_CONTROL_USER))
          .catch((error: unknown) =>
            this.logger.warn(
              `Refreshing ${scope} on ${server.address}: ${error instanceof Error ? error.message : error}`,
            ),
          );

      await this.dataSource.query(
        `UPDATE lw_backup_repositories SET users = users || $2::jsonb WHERE scope = $1 AND NOT users ? $3`,
        [scope, JSON.stringify([name]), name],
      );
    }

    return { scope, servers, fingerprint: row.fingerprint, ...user, password };
  }

  /** Direct (object-store) connection for blob-level secondary copies; only the control plane holds these keys. */
  async directConnection(
    scope: string,
    endpoint: string,
    generation: number,
    env: NodeJS.ProcessEnv = process.env,
  ): Promise<KopiaConnection & { kind: 's3' }> {
    const row = await this.get(scope);
    const encryptionKey = env['ENCRYPTION_KEY'];

    if (!row || !encryptionKey) throw new ServiceUnavailableException(`backup repository ${scope} is not available`);

    const s3 = objectStoreSecrets(encryptionKey, generation);
    const dataKey = await this.keys.forGeneration(row.keyGeneration);

    return {
      kind: 's3',
      endpoint,
      bucket: BACKUPS_BUCKET,
      prefix: `${scope}/`,
      accessKeyId: s3.backupsAccessKeyId,
      secretAccessKey: s3.backupsSecretAccessKey,
      password: repositoryPassword(dataKey, scope),
    };
  }
}

export function controlUser(): string {
  return `${KOPIA_CONTROL_USER.username}@${KOPIA_CONTROL_USER.hostname}`;
}
