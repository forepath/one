import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { SubscriptionEntity, SubscriptionStatus } from '../entities/subscription.entity';
import type { CustomerProfileEntity } from '../entities/customer-profile.entity';
import { hydrateEntitiesBySearchIds } from '../search/billing-search-hydrate.util';
import { applyBillingSearchIlike } from '../search/billing-search-ilike.util';
import { BillingSearchIndexService } from '../search/billing-search-index.service';
import { applyUserTenantFilter, getRequiredTenantId } from '../utils/tenant-query.utils';

export interface AdminSubscriptionListParams {
  limit: number;
  offset: number;
  search?: string;
  userId?: string;
}

export interface SubscriptionWithBillingProfile {
  subscription: SubscriptionEntity;
  profile: CustomerProfileEntity;
}

@Injectable()
export class SubscriptionsRepository {
  constructor(
    @InjectRepository(SubscriptionEntity)
    private readonly repository: Repository<SubscriptionEntity>,
    @Optional() private readonly billingSearchIndexService?: BillingSearchIndexService,
  ) {}

  async findByIdOrThrow(id: string): Promise<SubscriptionEntity> {
    const entity = await this.repository
      .createQueryBuilder('subscription')
      .innerJoin('users', 'user', 'user.id = subscription.user_id')
      .where('subscription.id = :id', { id })
      .andWhere('user.tenant_id = :tenantId', { tenantId: getRequiredTenantId() })
      .getOne();

    if (!entity) {
      throw new NotFoundException(`Subscription with ID ${id} not found`);
    }

    return entity;
  }

  async findById(id: string): Promise<SubscriptionEntity | null> {
    return await this.repository
      .createQueryBuilder('subscription')
      .innerJoin('users', 'user', 'user.id = subscription.user_id')
      .where('subscription.id = :id', { id })
      .andWhere('user.tenant_id = :tenantId', { tenantId: getRequiredTenantId() })
      .getOne();
  }

  async findByNumberWithBillingProfile(number: string): Promise<SubscriptionWithBillingProfile | null> {
    const row = await this.repository
      .createQueryBuilder('subscription')
      .innerJoin('users', 'user', 'user.id = subscription.user_id')
      .innerJoinAndMapOne(
        'subscription.profile',
        'billing_customer_profiles',
        'profile',
        'profile.user_id = subscription.user_id',
      )
      .where('subscription.number = :number', { number })
      .andWhere('user.tenant_id = :tenantId', { tenantId: getRequiredTenantId() })
      .getOne();

    if (!row) {
      return null;
    }

    const profile = (row as SubscriptionEntity & { profile?: CustomerProfileEntity }).profile;

    if (!profile) {
      return null;
    }

    return { subscription: row, profile };
  }

  async findAllByUser(userId: string, limit = 10, offset = 0, search?: string): Promise<SubscriptionEntity[]> {
    if (search?.trim() && this.billingSearchIndexService) {
      const lookup = await this.billingSearchIndexService.searchIds('subscriptions', search.trim(), {
        tenantId: getRequiredTenantId(),
        limit,
        offset,
        extraFilters: { userId },
      });
      const hydrated = await hydrateEntitiesBySearchIds(this.repository, lookup);

      if (hydrated) {
        return hydrated.items;
      }
    }

    const qb = this.repository
      .createQueryBuilder('subscription')
      .innerJoin('users', 'user', 'user.id = subscription.user_id')
      .where('subscription.user_id = :userId', { userId })
      .orderBy('subscription.createdAt', 'DESC')
      .take(limit)
      .skip(offset);

    applyUserTenantFilter(qb, 'user');

    if (search?.trim()) {
      qb.leftJoin('billing_service_plans', 'plan', 'plan.id = subscription.plan_id');
      applyBillingSearchIlike(qb, 'subscriptions', 'subscription', search, {
        planName: 'plan.name',
        userEmail: 'user.email',
      });
    }

    return await qb.getMany();
  }

  async findAllForUserInTenant(userId: string): Promise<SubscriptionEntity[]> {
    const qb = this.repository
      .createQueryBuilder('subscription')
      .innerJoin('users', 'user', 'user.id = subscription.user_id')
      .where('subscription.user_id = :userId', { userId })
      .orderBy('subscription.createdAt', 'DESC');

    applyUserTenantFilter(qb, 'user');

    return await qb.getMany();
  }

  async findAllForAdmin(params: AdminSubscriptionListParams): Promise<{ items: SubscriptionEntity[]; total: number }> {
    if (params.search?.trim() && this.billingSearchIndexService) {
      const lookup = await this.billingSearchIndexService.searchIds('subscriptions', params.search.trim(), {
        tenantId: getRequiredTenantId(),
        limit: params.limit,
        offset: params.offset,
        extraFilters: params.userId ? { userId: params.userId } : undefined,
      });

      const hydrated = await hydrateEntitiesBySearchIds(this.repository, lookup);

      if (hydrated) {
        return hydrated;
      }
    }

    const qb = this.repository
      .createQueryBuilder('subscription')
      .innerJoin('users', 'user', 'user.id = subscription.user_id');

    applyUserTenantFilter(qb, 'user');

    if (params.userId) {
      qb.andWhere('subscription.user_id = :userId', { userId: params.userId });
    }

    if (params.search?.trim()) {
      qb.leftJoin('billing_service_plans', 'plan', 'plan.id = subscription.plan_id');
      applyBillingSearchIlike(qb, 'subscriptions', 'subscription', params.search, {
        planName: 'plan.name',
        userEmail: 'user.email',
      });
    }

    const total = await qb.getCount();
    const items = await qb.orderBy('subscription.createdAt', 'DESC').take(params.limit).skip(params.offset).getMany();

    return { items, total };
  }

  async create(dto: Partial<SubscriptionEntity>): Promise<SubscriptionEntity> {
    const entity = this.repository.create(dto);

    return await this.repository.save(entity);
  }

  async update(id: string, dto: Partial<SubscriptionEntity>): Promise<SubscriptionEntity> {
    const entity = await this.findByIdOrThrow(id);

    Object.assign(entity, dto);

    return await this.repository.save(entity);
  }

  async delete(id: string): Promise<void> {
    const entity = await this.findByIdOrThrow(id);

    await this.repository.remove(entity);
  }

  /**
   * Compare-and-set on status so concurrent requests cannot both move a subscription
   * out of the same state. Returns false when another writer won the race.
   */
  async compareAndSetStatus(id: string, expected: SubscriptionStatus, next: SubscriptionStatus): Promise<boolean> {
    const result = await this.repository
      .createQueryBuilder()
      .update(SubscriptionEntity)
      .set({ status: next })
      .where('id = :id', { id })
      .andWhere('status = :expected', { expected })
      .andWhere('user_id IN (SELECT id FROM users WHERE tenant_id = :tenantId)', { tenantId: getRequiredTenantId() })
      .execute();

    return (result.affected ?? 0) > 0;
  }

  async findDueForBilling(now: Date = new Date(), limit = 100): Promise<SubscriptionEntity[]> {
    const qb = this.repository
      .createQueryBuilder('subscription')
      .innerJoin('users', 'user', 'user.id = subscription.user_id')
      .where('subscription.status = :status', { status: 'active' })
      .andWhere('subscription.nextBillingAt <= :now', { now })
      .orderBy('subscription.nextBillingAt', 'ASC')
      .take(limit);

    applyUserTenantFilter(qb, 'user');

    return await qb.getMany();
  }

  /**
   * Active / config-change arrear subscriptions eligible for meter collection.
   */
  async findActiveArrearForMeterCollect(limit = 500, offset = 0): Promise<SubscriptionEntity[]> {
    const qb = this.repository
      .createQueryBuilder('subscription')
      .innerJoin('users', 'user', 'user.id = subscription.user_id')
      .innerJoinAndSelect('subscription.plan', 'plan')
      .where('subscription.status IN (:...statuses)', {
        statuses: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PENDING_CONFIG_CHANGE],
      })
      .andWhere('plan.bill_in_advance = false')
      .orderBy('subscription.createdAt', 'ASC')
      .addOrderBy('subscription.id', 'ASC')
      .take(limit)
      .skip(offset);

    applyUserTenantFilter(qb, 'user');

    return await qb.getMany();
  }

  /**
   * Pending cancellations whose effective teardown time has passed: `teardownNotBefore` (Loadweaver grace period) when
   * set, else `cancelEffectiveAt`. Subscriptions still in a grace period are filtered out here so they never occupy
   * batch slots ahead of due ones; ordering stays by effective date.
   */
  async findDueForCancellation(now: Date = new Date(), limit = 100): Promise<SubscriptionEntity[]> {
    const qb = this.repository
      .createQueryBuilder('subscription')
      .innerJoin('users', 'user', 'user.id = subscription.user_id')
      .where('subscription.status = :status', { status: 'pending_cancel' })
      .andWhere('subscription.cancelEffectiveAt <= :now', { now })
      .andWhere('COALESCE(subscription.teardownNotBefore, subscription.cancelEffectiveAt) <= :now', { now })
      .orderBy('subscription.cancelEffectiveAt', 'ASC')
      .take(limit);

    applyUserTenantFilter(qb, 'user');

    return await qb.getMany();
  }

  async findDueForWithdrawal(now: Date = new Date(), limit = 100): Promise<SubscriptionEntity[]> {
    const qb = this.repository
      .createQueryBuilder('subscription')
      .innerJoin('users', 'user', 'user.id = subscription.user_id')
      .where('subscription.status = :status', { status: 'pending_withdrawal' })
      .andWhere('subscription.withdrawnAt <= :now', { now })
      // Loadweaver withdrawals keep the server for the teardown grace period (M4).
      .andWhere('COALESCE(subscription.teardownNotBefore, subscription.withdrawnAt) <= :now', { now })
      .orderBy('subscription.withdrawnAt', 'ASC')
      .take(limit);

    applyUserTenantFilter(qb, 'user');

    return await qb.getMany();
  }

  async findDueForInstantCancel(now: Date = new Date(), limit = 100): Promise<SubscriptionEntity[]> {
    const qb = this.repository
      .createQueryBuilder('subscription')
      .innerJoin('users', 'user', 'user.id = subscription.user_id')
      .where('subscription.status = :status', { status: 'pending_instant_cancel' })
      .andWhere('subscription.instantRemoval = :instantRemoval', { instantRemoval: true })
      .andWhere('subscription.instantCanceledAt <= :now', { now })
      // Loadweaver instant cancels keep the server for the teardown grace period (M4).
      .andWhere('COALESCE(subscription.teardownNotBefore, subscription.instantCanceledAt) <= :now', { now })
      .orderBy('subscription.instantCanceledAt', 'ASC')
      .take(limit);

    applyUserTenantFilter(qb, 'user');

    return await qb.getMany();
  }

  async countByStatus(status: string): Promise<number> {
    const qb = this.repository
      .createQueryBuilder('subscription')
      .innerJoin('users', 'user', 'user.id = subscription.user_id')
      .where('subscription.status = :status', { status });

    applyUserTenantFilter(qb, 'user');

    return await qb.getCount();
  }

  async countAll(): Promise<number> {
    const qb = this.repository
      .createQueryBuilder('subscription')
      .innerJoin('users', 'user', 'user.id = subscription.user_id');

    applyUserTenantFilter(qb, 'user');

    return await qb.getCount();
  }

  async countByUserId(userId: string): Promise<number> {
    const qb = this.repository
      .createQueryBuilder('subscription')
      .innerJoin('users', 'user', 'user.id = subscription.user_id')
      .where('subscription.user_id = :userId', { userId });

    applyUserTenantFilter(qb, 'user');

    return await qb.getCount();
  }

  async countByUserIdAndStatus(userId: string, status: string): Promise<number> {
    const qb = this.repository
      .createQueryBuilder('subscription')
      .innerJoin('users', 'user', 'user.id = subscription.user_id')
      .where('subscription.user_id = :userId', { userId })
      .andWhere('subscription.status = :status', { status });

    applyUserTenantFilter(qb, 'user');

    return await qb.getCount();
  }

  /** All subscriptions referencing a plan (used to block plan delete). */
  async countByPlanId(planId: string): Promise<number> {
    return await this.repository.count({ where: { planId } });
  }

  async findUpcomingRenewals(withinDays: number, now: Date = new Date(), limit = 100): Promise<SubscriptionEntity[]> {
    const futureDate = new Date(now);

    futureDate.setDate(futureDate.getDate() + withinDays);

    const qb = this.repository
      .createQueryBuilder('subscription')
      .innerJoin('users', 'user', 'user.id = subscription.user_id')
      .where('subscription.status = :status', { status: 'active' })
      .andWhere('subscription.nextBillingAt > :now', { now })
      .andWhere('subscription.nextBillingAt <= :futureDate', { futureDate })
      .orderBy('subscription.nextBillingAt', 'ASC')
      .take(limit);

    applyUserTenantFilter(qb, 'user');

    return await qb.getMany();
  }

  async findEligibleForPriceRecalcByPlanId(planId: string): Promise<SubscriptionEntity[]> {
    const qb = this.repository
      .createQueryBuilder('subscription')
      .innerJoin('users', 'user', 'user.id = subscription.user_id')
      .leftJoinAndSelect('subscription.plan', 'plan')
      .where('subscription.plan_id = :planId', { planId })
      .andWhere('subscription.status IN (:...statuses)', {
        statuses: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PENDING_CANCEL],
      })
      .orderBy('subscription.createdAt', 'ASC');

    applyUserTenantFilter(qb, 'user');

    return await qb.getMany();
  }
}
