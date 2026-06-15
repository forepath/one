import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ReservedHostnameEntity } from '../entities/reserved-hostname.entity';

@Injectable()
export class ReservedHostnamesRepository {
  constructor(
    @InjectRepository(ReservedHostnameEntity)
    private readonly repository: Repository<ReservedHostnameEntity>,
  ) {}

  async existsByHostname(hostname: string): Promise<boolean> {
    const count = await this.repository.count({ where: { hostname } });

    return count > 0;
  }

  async create(hostname: string, subscriptionItemId: string): Promise<ReservedHostnameEntity> {
    const entity = this.repository.create({ hostname, subscriptionItemId });

    return await this.repository.save(entity);
  }

  async deleteBySubscriptionItemId(subscriptionItemId: string): Promise<void> {
    await this.repository.delete({ subscriptionItemId });
  }

  async findBySubscriptionItemId(subscriptionItemId: string): Promise<ReservedHostnameEntity | null> {
    return await this.repository.findOne({ where: { subscriptionItemId } });
  }
}
