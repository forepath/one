import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { SubscriptionEntity } from '../entities/subscription.entity';
import { applyUserTenantFilter, getRequiredTenantId } from '../utils/tenant-query.utils';

@Injectable()
export class SubscriptionsRepository {
  constructor(
    @InjectRepository(SubscriptionEntity)
    private readonly repository: Repository<SubscriptionEntity>,
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

  async findAllByUser(userId: string, limit = 10, offset = 0): Promise<SubscriptionEntity[]> {
    return await this.repository.find({
      where: { userId },
      take: limit,
      skip: offset,
      order: { createdAt: 'DESC' },
    });
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

  async findDueForCancellation(now: Date = new Date(), limit = 100): Promise<SubscriptionEntity[]> {
    const qb = this.repository
      .createQueryBuilder('subscription')
      .innerJoin('users', 'user', 'user.id = subscription.user_id')
      .where('subscription.status = :status', { status: 'pending_cancel' })
      .andWhere('subscription.cancelEffectiveAt <= :now', { now })
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
      .orderBy('subscription.withdrawnAt', 'ASC')
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
}
