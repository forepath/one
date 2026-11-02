import { createHash, randomBytes } from 'node:crypto';

import { LOADWEAVER_API_VERSION, type Resource, type ResourceKind } from '@forepath/loadweaver/shared/util-model';
import { createCertificateAuthority } from '@forepath/loadweaver/shared/util-pki';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';

import { ADVISORY_LOCK_CLUSTER_BOOTSTRAP, CLUSTER_CA_VALIDITY_DAYS } from '../constants/control-plane.constants';
import { ClusterEntity } from '../entities/cluster.entity';
import { JoinTokenEntity } from '../entities/join-token.entity';
import { ResourceEntity } from '../entities/resource.entity';
import { defaultClusterNetwork } from '../utils/network-allocation.utils';
import { AuditLogService } from './audit-log.service';
import { parseJoinToken } from './join-tokens.service';
import { ResourceStoreService } from './resource-store.service';

export const DEFAULT_SITE = 'default';

function clusterIdFromEnv(): string {
  const fromEnv = process.env.LOADWEAVER_CLUSTER_ID?.trim();

  if (fromEnv) {
    if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(fromEnv)) {
      throw new Error('LOADWEAVER_CLUSTER_ID must be a lowercase DNS label');
    }

    return fromEnv;
  }

  return `lw-${randomBytes(4).toString('hex')}`;
}

/**
 * Creates the cluster on first start: cluster id, cluster CA, default `Cluster` and `Site` resources.
 * Idempotent and safe with several control-plane replicas starting at once (advisory lock).
 */
@Injectable()
export class ClusterBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(ClusterBootstrapService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly audit: AuditLogService,
    private readonly store: ResourceStoreService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureCluster();
  }

  async ensureCluster(): Promise<ClusterEntity> {
    return await this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock($1)', [ADVISORY_LOCK_CLUSTER_BOOTSTRAP]);

      const existing = await manager.getRepository(ClusterEntity).findOne({ where: {} });

      if (existing) return existing;

      const clusterId = clusterIdFromEnv();
      const ca = await createCertificateAuthority({
        commonName: `Loadweaver cluster CA ${clusterId}`,
        validityDays: CLUSTER_CA_VALIDITY_DAYS,
      });
      const cluster = await manager.getRepository(ClusterEntity).save(
        manager.getRepository(ClusterEntity).create({
          clusterId,
          displayName: process.env.LOADWEAVER_CLUSTER_NAME?.trim() || clusterId,
          caCertificate: ca.certificatePem,
          caPrivateKey: ca.privateKeyPem,
          networkState: {},
          desiredRevision: 0,
        }),
      );

      await this.ensureResource(manager, 'Cluster', clusterId, {
        network: defaultClusterNetwork((n) => randomBytes(n)),
      });
      await this.ensureResource(manager, 'Site', DEFAULT_SITE, {});
      await this.registerBootstrapJoinToken(manager);
      await this.audit.record(manager, {
        actor: { type: 'system' },
        action: 'cluster.bootstrap',
        target: `cluster/${clusterId}`,
        details: { clusterId },
      });
      this.logger.log(`Bootstrapped cluster ${clusterId}`);

      return cluster;
    });
  }

  /**
   * The first node's agent creates the control plane and then joins it with a one-time token it generated
   * itself (`LOADWEAVER_BOOTSTRAP_JOIN_TOKEN`). Only honoured while the cluster is being created.
   */
  private async registerBootstrapJoinToken(manager: EntityManager): Promise<void> {
    const token = process.env.LOADWEAVER_BOOTSTRAP_JOIN_TOKEN?.trim();

    if (!token) return;

    const parsed = parseJoinToken(token);

    if (!parsed) throw new Error('LOADWEAVER_BOOTSTRAP_JOIN_TOKEN has an invalid format');

    const repo = manager.getRepository(JoinTokenEntity);

    await repo.save(
      repo.create({
        tokenPrefix: parsed.prefix,
        tokenHash: createHash('sha256').update(token).digest('hex'),
        description: 'bootstrap node',
        site: DEFAULT_SITE,
        labels: {},
        witness: false,
        expiresAt: new Date(Date.now() + 60 * 60_000),
        createdBy: 'system',
      }),
    );
  }

  private async ensureResource(
    manager: EntityManager,
    kind: ResourceKind,
    name: string,
    spec: Record<string, unknown>,
  ): Promise<void> {
    if (await manager.getRepository(ResourceEntity).findOne({ where: { kind, name, projectKey: '' } })) return;

    await this.store.upsert(
      manager,
      { apiVersion: LOADWEAVER_API_VERSION, kind, metadata: { name }, spec } as Resource,
      'system',
    );
  }
}
