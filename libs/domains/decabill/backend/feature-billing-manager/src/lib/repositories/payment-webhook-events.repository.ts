import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { PaymentWebhookEventEntity } from '../entities/payment-webhook-event.entity';

@Injectable()
export class PaymentWebhookEventsRepository {
  constructor(
    @InjectRepository(PaymentWebhookEventEntity)
    private readonly repository: Repository<PaymentWebhookEventEntity>,
  ) {}

  async exists(processor: string, eventId: string): Promise<boolean> {
    const count = await this.repository.count({ where: { processor, eventId } });

    return count > 0;
  }

  async create(dto: Partial<PaymentWebhookEventEntity>): Promise<PaymentWebhookEventEntity> {
    const entity = this.repository.create(dto);

    return await this.repository.save(entity);
  }
}
