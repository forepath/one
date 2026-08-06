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
}
