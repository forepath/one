import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { UsageRecordEntity } from '../entities/usage-record.entity';

@Injectable()
export class UsageRecordsRepository {
  constructor(
    @InjectRepository(UsageRecordEntity)
    private readonly repository: Repository<UsageRecordEntity>,
  ) {}

  async findLatestForSubscription(subscriptionId: string): Promise<UsageRecordEntity | null> {
    return await this.repository.findOne({
      where: { subscriptionId },
      order: { createdAt: 'DESC' },
    });
  }

  async create(dto: Partial<UsageRecordEntity>): Promise<UsageRecordEntity> {
    const entity = this.repository.create(dto);

    return await this.repository.save(entity);
  }
}
