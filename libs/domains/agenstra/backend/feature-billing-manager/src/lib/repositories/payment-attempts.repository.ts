import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { PaymentAttemptEntity, PaymentAttemptStatus } from '../entities/payment-attempt.entity';
import { applyUserTenantFilter, getRequiredTenantId } from '../utils/tenant-query.utils';

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
    const qb = this.repository
      .createQueryBuilder('attempt')
      .innerJoin('attempt.invoice', 'inv')
      .innerJoin('users', 'user', 'user.id = inv.user_id')
      .where('attempt.idempotency_key = :key', { key });

    applyUserTenantFilter(qb, 'user');

    return await qb.getOne();
  }

  async findByExternalId(processor: string, externalId: string): Promise<PaymentAttemptEntity | null> {
    const qb = this.repository
      .createQueryBuilder('attempt')
      .innerJoin('attempt.invoice', 'inv')
      .innerJoin('users', 'user', 'user.id = inv.user_id')
      .where('attempt.processor = :processor', { processor })
      .andWhere('attempt.external_id = :externalId', { externalId });

    applyUserTenantFilter(qb, 'user');

    return await qb.getOne();
  }

  async update(id: string, dto: Partial<PaymentAttemptEntity>): Promise<PaymentAttemptEntity> {
    const entity = await this.findByIdInTenant(id);

    Object.assign(entity, dto);

    return await this.repository.save(entity);
  }

  async findLatestPendingByInvoiceId(invoiceId: string): Promise<PaymentAttemptEntity | null> {
    const qb = this.repository
      .createQueryBuilder('attempt')
      .innerJoin('attempt.invoice', 'inv')
      .innerJoin('users', 'user', 'user.id = inv.user_id')
      .where('attempt.invoice_id = :invoiceId', { invoiceId })
      .andWhere('attempt.status = :status', { status: PaymentAttemptStatus.PENDING })
      .orderBy('attempt.createdAt', 'DESC')
      .take(1);

    applyUserTenantFilter(qb, 'user');

    return await qb.getOne();
  }

  private async findByIdInTenant(id: string): Promise<PaymentAttemptEntity> {
    const entity = await this.repository
      .createQueryBuilder('attempt')
      .innerJoin('attempt.invoice', 'inv')
      .innerJoin('users', 'user', 'user.id = inv.user_id')
      .where('attempt.id = :id', { id })
      .andWhere('user.tenant_id = :tenantId', { tenantId: getRequiredTenantId() })
      .getOne();

    if (!entity) {
      throw new NotFoundException(`Payment attempt ${id} not found`);
    }

    return entity;
  }
}
