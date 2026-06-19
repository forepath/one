import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ReservedHostnameEntity } from '../entities/reserved-hostname.entity';
import { applyUserTenantFilter, getRequiredTenantId } from '../utils/tenant-query.utils';

@Injectable()
export class ReservedHostnamesRepository {
  constructor(
    @InjectRepository(ReservedHostnameEntity)
    private readonly repository: Repository<ReservedHostnameEntity>,
  ) {}

  async existsByHostname(hostname: string): Promise<boolean> {
    const qb = this.repository
      .createQueryBuilder('host')
      .innerJoin('host.subscriptionItem', 'item')
      .innerJoin('item.subscription', 'sub')
      .innerJoin('users', 'user', 'user.id = sub.user_id')
      .where('host.hostname = :hostname', { hostname });

    applyUserTenantFilter(qb, 'user');

    const count = await qb.getCount();

    return count > 0;
  }

  async create(hostname: string, subscriptionItemId: string): Promise<ReservedHostnameEntity> {
    const entity = this.repository.create({ hostname, subscriptionItemId });

    return await this.repository.save(entity);
  }

  async deleteBySubscriptionItemId(subscriptionItemId: string): Promise<void> {
    const row = await this.findBySubscriptionItemId(subscriptionItemId);

    if (row) {
      await this.repository.delete(row.id);
    }
  }

  async findBySubscriptionItemId(subscriptionItemId: string): Promise<ReservedHostnameEntity | null> {
    const qb = this.repository
      .createQueryBuilder('host')
      .innerJoin('host.subscriptionItem', 'item')
      .innerJoin('item.subscription', 'sub')
      .innerJoin('users', 'user', 'user.id = sub.user_id')
      .where('host.subscription_item_id = :subscriptionItemId', { subscriptionItemId })
      .andWhere('user.tenant_id = :tenantId', { tenantId: getRequiredTenantId() });

    return await qb.getOne();
  }
}
