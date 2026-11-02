import {
  clusterSpecSchema,
  ipPoolSpecSchema,
  policySpecSchema,
  type IpPoolSpec,
} from '@forepath/loadweaver/shared/util-model';
import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';

import { PublicAddressEntity } from '../entities/public-address.entity';
import type { ResourceEntity } from '../entities/resource.entity';
import { clusterClaims, dnsClaims, egressClaims, planPublicAddresses, type AddressPlan } from './public-ipam.utils';
import { dnsProviders } from '../dns/dns.service';

const ADVISORY_LOCK_PUBLIC_ADDRESSES = 0x4c57000b;

export function ipPools(resources: readonly Pick<ResourceEntity, 'kind' | 'name' | 'spec'>[]): Map<string, IpPoolSpec> {
  return new Map(resources.filter((r) => r.kind === 'IpPool').map((r) => [r.name, ipPoolSpecSchema.parse(r.spec)]));
}

/** Public IPAM in plans and applies (3.27). */
@Injectable()
export class PublicAddressService {
  /** What the given desired state assigns; errors reject the plan. */
  async plan(manager: EntityManager, resources: readonly ResourceEntity[], now = new Date()): Promise<AddressPlan> {
    const cluster = resources.find((r) => r.kind === 'Cluster');
    const spec = cluster ? clusterSpecSchema.parse(cluster.spec) : undefined;
    const current = await manager.getRepository(PublicAddressEntity).find();

    return planPublicAddresses(
      ipPools(resources),
      current,
      [
        ...clusterClaims(spec?.ingress, spec?.remoteAccess),
        ...dnsClaims(dnsProviders(resources)),
        ...egressClaims(
          resources
            .filter((r) => r.kind === 'Policy')
            .map((r) => ({ project: r.project, name: r.name, spec: policySpecSchema.parse(r.spec) })),
        ),
      ],
      now,
    );
  }

  /** Writes the assignment inside the apply transaction. */
  async persist(manager: EntityManager, resources: readonly ResourceEntity[], now = new Date()): Promise<AddressPlan> {
    await manager.query('SELECT pg_advisory_xact_lock($1)', [ADVISORY_LOCK_PUBLIC_ADDRESSES]);

    const plan = await this.plan(manager, resources, now);

    if (plan.errors.length > 0) throw new Error(plan.errors.join('; '));

    const repo = manager.getRepository(PublicAddressEntity);

    for (const address of plan.removed) await repo.delete({ address });

    for (const row of plan.rows) await repo.save(repo.create(row));

    return plan;
  }
}
