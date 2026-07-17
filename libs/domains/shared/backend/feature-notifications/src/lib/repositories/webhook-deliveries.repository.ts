import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';

import { WebhookDeliveryEntity } from '../entities/webhook-delivery.entity';

@Injectable()
export class WebhookDeliveriesRepository {
  constructor(
    @InjectRepository(WebhookDeliveryEntity)
    private readonly repository: Repository<WebhookDeliveryEntity>,
  ) {}

  async create(data: Partial<WebhookDeliveryEntity>): Promise<WebhookDeliveryEntity> {
    const entity = this.repository.create(data);

    return await this.repository.save(entity);
  }

  async findByEndpointId(
    endpointId: string,
    limit: number,
    offset: number,
  ): Promise<{ items: WebhookDeliveryEntity[]; total: number }> {
    const [items, total] = await this.repository.findAndCount({
      where: { endpointId },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    return { items, total };
  }

  async findLatestByEndpointId(endpointId: string): Promise<WebhookDeliveryEntity | null> {
    return await this.repository.findOne({
      where: { endpointId },
      order: { createdAt: 'DESC' },
    });
  }

  async countByEndpointId(endpointId: string): Promise<number> {
    return await this.repository.count({ where: { endpointId } });
  }

  async deleteAllByEndpointId(endpointId: string): Promise<number> {
    const result = await this.repository.delete({ endpointId });

    return result.affected ?? 0;
  }

  async deleteOlderThan(endpointId: string, cutoff: Date): Promise<number> {
    const result = await this.repository.delete({
      endpointId,
      createdAt: LessThan(cutoff),
    });

    return result.affected ?? 0;
  }

  async deleteOldestExcess(endpointId: string, keepCount: number): Promise<number> {
    const subQuery = this.repository
      .createQueryBuilder('delivery')
      .select('delivery.id')
      .where('delivery.endpoint_id = :endpointId', { endpointId })
      .orderBy('delivery.created_at', 'DESC')
      .offset(keepCount);

    const result = await this.repository
      .createQueryBuilder()
      .delete()
      .from(WebhookDeliveryEntity)
      .where(`id IN (${subQuery.getQuery()})`)
      .setParameters(subQuery.getParameters())
      .execute();

    return result.affected ?? 0;
  }
}
