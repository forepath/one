import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { UsageRecordEntity } from '../entities/usage-record.entity';
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

  async create(dto: Partial<UsageRecordEntity>): Promise<UsageRecordEntity> {
    const entity = this.repository.create(dto);

    return await this.repository.save(entity);
  }
}
