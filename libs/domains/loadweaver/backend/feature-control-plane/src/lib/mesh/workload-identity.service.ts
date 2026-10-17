import type { WorkloadIdentities, WorkloadIdentityRequest } from '@forepath/loadweaver/shared/util-agent-protocol';
import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { WorkloadPlacementEntity } from '../entities/workload-placement.entity';
import { ClusterIdentityService } from '../services/cluster-identity.service';

/**
 * Workload identities for the node proxies (3.7): a node gets the identity of a service only while it runs (or is
 * about to run, during a migration) one of its replicas. The node generates the keys; only CSRs come here.
 */
@Injectable()
export class WorkloadIdentityService {
  private readonly logger = new Logger(WorkloadIdentityService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly identity: ClusterIdentityService,
  ) {}

  /** Identities the node may hold: services with a replica placed on it. */
  async allowed(nodeName: string): Promise<Set<string>> {
    const placements = await this.dataSource
      .getRepository(WorkloadPlacementEntity)
      .find({ where: [{ node: nodeName }, { targetNode: nodeName }] });

    return new Set(placements.map((p) => `${p.project}/${p.deployment}/${p.service}`));
  }

  async issue(nodeName: string, request: WorkloadIdentityRequest): Promise<WorkloadIdentities> {
    const allowed = await this.allowed(nodeName);
    const certificates: WorkloadIdentities['certificates'] = [];
    const refused: string[] = [];

    for (const { identity, csrPem } of request.requests) {
      if (!allowed.has(identity)) {
        refused.push(identity);
        continue;
      }

      try {
        certificates.push({
          identity,
          certificatePem: (await this.identity.issueWorkloadCertificate(identity, csrPem)).certificatePem,
        });
      } catch (error) {
        this.logger.warn(
          `Workload identity ${identity} for ${nodeName}: ${error instanceof Error ? error.message : String(error)}`,
        );
        refused.push(identity);
      }
    }

    if (refused.length > 0) this.logger.warn(`Refused workload identities for ${nodeName}: ${refused.join(', ')}`);

    return { certificates, refused, caCertificatePem: await this.identity.caCertificate() };
  }
}
