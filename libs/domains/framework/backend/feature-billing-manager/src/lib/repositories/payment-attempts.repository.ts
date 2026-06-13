import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { PaymentAttemptEntity, PaymentAttemptStatus } from '../entities/payment-attempt.entity';

@Injectable()
export class PaymentAttemptsRepository {
  constructor(
    @InjectRepository(PaymentAttemptEntity)
    private readonly repository: Repository<PaymentAttemptEntity>,
  ) {}

  async create(dto: Partial<PaymentAttemptEntity>): Promise<PaymentAttemptEntity> {
    const entity = this.repository.create(dto);

    return await this.repository.save(entity);
  }

  async findByIdempotencyKey(key: string): Promise<PaymentAttemptEntity | null> {
    return await this.repository.findOne({ where: { idempotencyKey: key } });
  }

  async findByExternalId(processor: string, externalId: string): Promise<PaymentAttemptEntity | null> {
    return await this.repository.findOne({ where: { processor, externalId } });
  }

  async update(id: string, dto: Partial<PaymentAttemptEntity>): Promise<PaymentAttemptEntity> {
    const entity = await this.repository.findOne({ where: { id } });

    if (!entity) {
      throw new NotFoundException(`Payment attempt ${id} not found`);
    }

    Object.assign(entity, dto);

    return await this.repository.save(entity);
  }

  async findLatestPendingByInvoiceId(invoiceId: string): Promise<PaymentAttemptEntity | null> {
    return await this.repository.findOne({
      where: { invoiceId, status: PaymentAttemptStatus.PENDING },
      order: { createdAt: 'DESC' },
    });
  }
}
