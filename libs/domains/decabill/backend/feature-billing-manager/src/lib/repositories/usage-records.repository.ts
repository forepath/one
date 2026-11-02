import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { UsageRecordEntity, type UsageAttachmentType } from '../entities/usage-record.entity';
import { applyUserTenantFilter } from '../utils/tenant-query.utils';

@Injectable()
export class UsageRecordsRepository {
  constructor(
    @InjectRepository(UsageRecordEntity)
    private readonly repository: Repository<UsageRecordEntity>,
  ) {}

  async findLatestForSubscription(subscriptionId: string): Promise<UsageRecordEntity | null> {
    const qb = this.repository
      .createQueryBuilder('usage')
      .innerJoin('usage.subscription', 'sub')
      .innerJoin('users', 'user', 'user.id = sub.user_id')
      .where('usage.subscription_id = :subscriptionId', { subscriptionId })
      .orderBy('usage.createdAt', 'DESC')
      .take(1);

    applyUserTenantFilter(qb, 'user');

    return await qb.getOne();
  }

  async findBySubscriptionId(subscriptionId: string): Promise<UsageRecordEntity[]> {
    const qb = this.repository
      .createQueryBuilder('usage')
      .innerJoin('usage.subscription', 'sub')
      .innerJoin('users', 'user', 'user.id = sub.user_id')
      .where('usage.subscription_id = :subscriptionId', { subscriptionId })
      .orderBy('usage.createdAt', 'DESC');

    applyUserTenantFilter(qb, 'user');

    return await qb.getMany();
  }

  async findByIdForSubscription(subscriptionId: string, entryId: string): Promise<UsageRecordEntity | null> {
    const qb = this.repository
      .createQueryBuilder('usage')
      .innerJoin('usage.subscription', 'sub')
      .innerJoin('users', 'user', 'user.id = sub.user_id')
      .where('usage.subscription_id = :subscriptionId', { subscriptionId })
      .andWhere('usage.id = :entryId', { entryId });

    applyUserTenantFilter(qb, 'user');

    return await qb.getOne();
  }

  async findByIdForSubscriptionOrThrow(subscriptionId: string, entryId: string): Promise<UsageRecordEntity> {
    const entity = await this.findByIdForSubscription(subscriptionId, entryId);

    if (!entity) {
      throw new NotFoundException('Usage record not found');
    }

    return entity;
  }

  async countByMeterId(meterId: string): Promise<number> {
    return await this.repository.count({ where: { meterId } });
  }

  async create(dto: Partial<UsageRecordEntity>): Promise<UsageRecordEntity> {
    const entity = this.repository.create(dto);

    return await this.repository.save(entity);
  }

  async update(entity: UsageRecordEntity, dto: Partial<UsageRecordEntity>): Promise<UsageRecordEntity> {
    Object.assign(entity, dto);

    return await this.repository.save(entity);
  }

  async delete(entity: UsageRecordEntity): Promise<void> {
    await this.repository.remove(entity);
  }

  async findMeteredForSubscription(
    subscriptionId: string,
    options?: { meterId?: string; attachmentType?: UsageAttachmentType; addonId?: string | null },
  ): Promise<UsageRecordEntity[]> {
    const qb = this.repository
      .createQueryBuilder('usage')
      .innerJoin('usage.subscription', 'sub')
      .innerJoin('users', 'user', 'user.id = sub.user_id')
      .where('usage.subscription_id = :subscriptionId', { subscriptionId })
      .andWhere('usage.meter_id IS NOT NULL')
      .orderBy('usage.createdAt', 'DESC');

    if (options?.meterId) {
      qb.andWhere('usage.meter_id = :meterId', { meterId: options.meterId });
    }

    if (options?.attachmentType) {
      qb.andWhere('usage.attachment_type = :attachmentType', { attachmentType: options.attachmentType });
    }

    if (options?.addonId) {
      qb.andWhere('usage.addon_id = :addonId', { addonId: options.addonId });
    }

    applyUserTenantFilter(qb, 'user');

    return await qb.getMany();
  }

  /** One page of a subscription's metered entries (newest first) with the total; tenant-scoped like the full list. */
  async findMeteredForSubscriptionPage(
    subscriptionId: string,
    limit: number,
    offset: number,
  ): Promise<{ items: UsageRecordEntity[]; total: number }> {
    const qb = this.repository
      .createQueryBuilder('usage')
      .innerJoin('usage.subscription', 'sub')
      .innerJoin('users', 'user', 'user.id = sub.user_id')
      .where('usage.subscription_id = :subscriptionId', { subscriptionId })
      .andWhere('usage.meter_id IS NOT NULL')
      .orderBy('usage.createdAt', 'DESC')
      .take(limit)
      .skip(offset);

    applyUserTenantFilter(qb, 'user');

    const [items, total] = await qb.getManyAndCount();

    return { items, total };
  }

  async findMeteredForSubscriptionInRange(subscriptionId: string, from: Date, to: Date): Promise<UsageRecordEntity[]> {
    const qb = this.repository
      .createQueryBuilder('usage')
      .innerJoin('usage.subscription', 'sub')
      .innerJoin('users', 'user', 'user.id = sub.user_id')
      .where('usage.subscription_id = :subscriptionId', { subscriptionId })
      .andWhere('usage.meter_id IS NOT NULL')
      .andWhere('usage.period_end >= :from', { from })
      .andWhere('usage.period_end <= :to', { to })
      .orderBy('usage.period_end', 'ASC')
      .addOrderBy('usage.createdAt', 'ASC');

    applyUserTenantFilter(qb, 'user');

    return await qb.getMany();
  }

  async findLatestCollectorForMeter(params: {
    subscriptionId: string;
    meterId: string;
    attachmentType: UsageAttachmentType;
    addonId?: string | null;
  }): Promise<UsageRecordEntity | null> {
    const qb = this.repository
      .createQueryBuilder('usage')
      .innerJoin('usage.subscription', 'sub')
      .innerJoin('users', 'user', 'user.id = sub.user_id')
      .where('usage.subscription_id = :subscriptionId', { subscriptionId: params.subscriptionId })
      .andWhere('usage.meter_id = :meterId', { meterId: params.meterId })
      .andWhere('usage.usage_source = :usageSource', { usageSource: 'collector' })
      .andWhere('usage.attachment_type = :attachmentType', { attachmentType: params.attachmentType })
      .orderBy('usage.period_end', 'DESC')
      .addOrderBy('usage.createdAt', 'DESC')
      .take(1);

    if (params.attachmentType === 'addon') {
      qb.andWhere('usage.addon_id = :addonId', { addonId: params.addonId ?? null });
    } else {
      qb.andWhere('usage.addon_id IS NULL');
    }

    applyUserTenantFilter(qb, 'user');

    return await qb.getOne();
  }

  /** Whether a usage row with this idempotency key exists for the subscription and meter (collector dedupe). */
  async existsByIdempotencyKey(params: {
    subscriptionId: string;
    meterId: string;
    idempotencyKey: string;
  }): Promise<boolean> {
    const qb = this.repository
      .createQueryBuilder('usage')
      .innerJoin('usage.subscription', 'sub')
      .innerJoin('users', 'user', 'user.id = sub.user_id')
      .where('usage.subscription_id = :subscriptionId', { subscriptionId: params.subscriptionId })
      .andWhere('usage.meter_id = :meterId', { meterId: params.meterId })
      .andWhere("usage.usage_payload ->> 'idempotencyKey' = :idempotencyKey", {
        idempotencyKey: params.idempotencyKey,
      });

    applyUserTenantFilter(qb, 'user');

    return (await qb.getCount()) > 0;
  }
}
