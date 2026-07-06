import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { PaymentRefundEntity, PaymentRefundStatus } from '../entities/payment-refund.entity';

@Injectable()
export class PaymentRefundsRepository {
  constructor(
    @InjectRepository(PaymentRefundEntity)
    private readonly repository: Repository<PaymentRefundEntity>,
  ) {}

  async create(dto: {
    invoiceId: string;
    amount: number;
    currency: string;
    processor: string;
    reason: string;
    status?: PaymentRefundStatus;
    externalRefundId?: string;
  }): Promise<PaymentRefundEntity> {
    const entity = this.repository.create({
      ...dto,
      status: dto.status ?? PaymentRefundStatus.PENDING,
    });

    return await this.repository.save(entity);
  }

  async update(
    id: string,
    dto: Partial<Pick<PaymentRefundEntity, 'status' | 'externalRefundId'>>,
  ): Promise<PaymentRefundEntity> {
    const entity = await this.repository.findOneOrFail({ where: { id } });

    Object.assign(entity, dto);

    return await this.repository.save(entity);
  }
}
