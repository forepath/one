import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { SubscriptionItemEntity } from '../entities/subscription-item.entity';
import { SubscriptionStatus } from '../entities/subscription.entity';
import { applyUserTenantFilter, getRequiredTenantId } from '../utils/tenant-query.utils';

@Injectable()
export class SubscriptionItemsRepository {
  constructor(
    @InjectRepository(SubscriptionItemEntity)
    private readonly repository: Repository<SubscriptionItemEntity>,
  ) {}

  async create(dto: Partial<SubscriptionItemEntity>): Promise<SubscriptionItemEntity> {
    const entity = this.repository.create(dto);

    return await this.repository.save(entity);
  }

  async delete(id: string): Promise<void> {
    const entity = await this.findByIdInTenant(id);

    await this.repository.remove(entity);
  }

  async updateProviderReference(id: string, providerReference: string): Promise<SubscriptionItemEntity> {
    const entity = await this.findByIdInTenant(id);

    entity.providerReference = providerReference;

    return await this.repository.save(entity);
  }

  async updateProvisioningStatus(id: string, status: 'pending' | 'active' | 'failed'): Promise<SubscriptionItemEntity> {
    const entity = await this.findByIdInTenant(id);

    entity.provisioningStatus = status as SubscriptionItemEntity['provisioningStatus'];

    if (status === 'active' && !entity.provisionedAt) {
      entity.provisionedAt = new Date();
    }

    return await this.repository.save(entity);
  }

  async findBySubscriptionIds(subscriptionIds: string[]): Promise<SubscriptionItemEntity[]> {
    if (subscriptionIds.length === 0) {
      return [];
    }

    const qb = this.repository
      .createQueryBuilder('item')
      .innerJoin('item.subscription', 'sub')
      .innerJoin('users', 'user', 'user.id = sub.user_id')
      .leftJoinAndSelect('item.serviceType', 'st')
      .where('item.subscription_id IN (:...subscriptionIds)', { subscriptionIds });

    applyUserTenantFilter(qb, 'user');

    return await qb.getMany();
  }

  async findBySubscription(subscriptionId: string): Promise<SubscriptionItemEntity[]> {
    const qb = this.repository
      .createQueryBuilder('item')
      .innerJoin('item.subscription', 'sub')
      .innerJoin('users', 'user', 'user.id = sub.user_id')
      .leftJoinAndSelect('item.serviceType', 'st')
      .where('item.subscription_id = :subscriptionId', { subscriptionId });

    applyUserTenantFilter(qb, 'user');

    return await qb.getMany();
  }

  async findByIdWithRelations(id: string): Promise<SubscriptionItemEntity | null> {
    const qb = this.repository
      .createQueryBuilder('item')
      .innerJoinAndSelect('item.subscription', 'sub')
      .innerJoin('users', 'user', 'user.id = sub.user_id')
      .leftJoinAndSelect('item.serviceType', 'st')
      .where('item.id = :id', { id });

    applyUserTenantFilter(qb, 'user');

    return await qb.getOne();
  }

  async findByIdAndSubscriptionId(id: string, subscriptionId: string): Promise<SubscriptionItemEntity | null> {
    const qb = this.repository
      .createQueryBuilder('item')
      .innerJoinAndSelect('item.subscription', 'sub')
      .innerJoin('users', 'user', 'user.id = sub.user_id')
      .leftJoinAndSelect('item.serviceType', 'st')
      .where('item.id = :id', { id })
      .andWhere('item.subscription_id = :subscriptionId', { subscriptionId });

    applyUserTenantFilter(qb, 'user');

    return await qb.getOne();
  }

  async updateServerInfoSnapshot(id: string, snapshot: Record<string, unknown>): Promise<SubscriptionItemEntity> {
    const entity = await this.findByIdInTenant(id);

    entity.serverInfoSnapshot = snapshot;

    return await this.repository.save(entity);
  }

  async updateHostname(id: string, hostname: string | null): Promise<SubscriptionItemEntity> {
    const entity = await this.findByIdInTenant(id);

    entity.hostname = hostname ?? undefined;

    return await this.repository.save(entity);
  }

  async updateSshPrivateKey(id: string, privateKeyPlain: string): Promise<SubscriptionItemEntity> {
    const entity = await this.findByIdInTenant(id);

    entity.sshPrivateKey = privateKeyPlain;

    return await this.repository.save(entity);
  }

  /**
   * Returns provisioned subscription items that have an SSH private key and belong to an active subscription.
   * Used by the update scheduler to run docker compose pull/up over SSH.
   */
  async findProvisionedWithSshKey(): Promise<SubscriptionItemEntity[]> {
    const qb = this.repository
      .createQueryBuilder('item')
      .innerJoinAndSelect('item.subscription', 'sub')
      .innerJoin('users', 'user', 'user.id = sub.user_id')
      .innerJoinAndSelect('item.serviceType', 'st')
      .where('item.provisioning_status = :status', { status: 'active' })
      .andWhere('item.provider_reference IS NOT NULL')
      .andWhere('item.ssh_private_key IS NOT NULL')
      .andWhere('sub.status = :subStatus', { subStatus: SubscriptionStatus.ACTIVE });

    applyUserTenantFilter(qb, 'user');

    return await qb.getMany();
  }

  /**
   * Returns items still awaiting server provisioning: pending, without a provider reference,
   * on an active subscription, and backed by a provider that provisions servers. Used by the
   * provisioning coordinator to enqueue provisioning unit jobs.
   */
  async findPendingProvisioningIds(limit = 100): Promise<string[]> {
    const qb = this.repository
      .createQueryBuilder('item')
      .select('item.id', 'id')
      .innerJoin('item.subscription', 'sub')
      .innerJoin('users', 'user', 'user.id = sub.user_id')
      .innerJoin('item.serviceType', 'st')
      .where('item.provisioning_status = :status', { status: 'pending' })
      .andWhere('item.provider_reference IS NULL')
      .andWhere('sub.status = :subStatus', { subStatus: SubscriptionStatus.ACTIVE })
      .andWhere('st.provider IN (:...providers)', { providers: ['hetzner', 'digital-ocean'] })
      .orderBy('item.created_at', 'ASC')
      .take(limit);

    applyUserTenantFilter(qb, 'user');

    const rows = await qb.getRawMany<{ id: string }>();

    return rows.map((row) => row.id);
  }

  private async findByIdInTenant(id: string): Promise<SubscriptionItemEntity> {
    const entity = await this.repository
      .createQueryBuilder('item')
      .innerJoin('item.subscription', 'sub')
      .innerJoin('users', 'user', 'user.id = sub.user_id')
      .where('item.id = :id', { id })
      .andWhere('user.tenant_id = :tenantId', { tenantId: getRequiredTenantId() })
      .getOne();

    if (!entity) {
      throw new Error(`Subscription item ${id} not found`);
    }

    return entity;
  }
}
