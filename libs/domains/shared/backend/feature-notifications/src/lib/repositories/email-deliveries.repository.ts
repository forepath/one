import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { EmailDeliveryEntity } from '../entities/email-delivery.entity';

@Injectable()
export class EmailDeliveriesRepository {
  constructor(
    @InjectRepository(EmailDeliveryEntity)
    private readonly repository: Repository<EmailDeliveryEntity>,
  ) {}

  async create(data: Partial<EmailDeliveryEntity>): Promise<EmailDeliveryEntity> {
    const entity = this.repository.create(data);

    return await this.repository.save(entity);
  }
}
