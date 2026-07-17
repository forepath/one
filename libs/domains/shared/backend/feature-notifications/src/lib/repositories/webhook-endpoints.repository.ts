import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { WebhookEndpointEntity } from '../entities/webhook-endpoint.entity';

@Injectable()
export class WebhookEndpointsRepository {
  constructor(
    @InjectRepository(WebhookEndpointEntity)
    private readonly repository: Repository<WebhookEndpointEntity>,
  ) {}

  async create(data: Partial<WebhookEndpointEntity>): Promise<WebhookEndpointEntity> {
    const entity = this.repository.create(data);

    return await this.repository.save(entity);
  }

  async save(entity: WebhookEndpointEntity): Promise<WebhookEndpointEntity> {
    return await this.repository.save(entity);
  }

  async findByIdAndScope(id: string, scopeKey: string): Promise<WebhookEndpointEntity | null> {
    return await this.repository.findOne({ where: { id, scopeKey } });
  }

  async findAllByScope(scopeKey: string, limit: number, offset: number): Promise<WebhookEndpointEntity[]> {
    return await this.repository.find({
      where: { scopeKey },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
  }

  async findMatchingForDispatch(scopeKey: string, eventType: string): Promise<WebhookEndpointEntity[]> {
    return await this.repository
      .createQueryBuilder('endpoint')
      .where('endpoint.scope_key = :scopeKey', { scopeKey })
      .andWhere('endpoint.enabled = true')
      .andWhere('endpoint.subscribed_events @> :eventTypeJson', { eventTypeJson: JSON.stringify([eventType]) })
      .getMany();
  }

  async findAllBatch(offset: number, limit: number): Promise<WebhookEndpointEntity[]> {
    return await this.repository.find({
      order: { createdAt: 'ASC' },
      take: limit,
      skip: offset,
    });
  }

  async delete(entity: WebhookEndpointEntity): Promise<void> {
    await this.repository.remove(entity);
  }
}
