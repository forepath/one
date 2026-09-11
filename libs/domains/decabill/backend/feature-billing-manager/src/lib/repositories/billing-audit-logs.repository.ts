import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { BillingAuditLogEntity } from '../entities/billing-audit-log.entity';
import { getRequiredTenantId } from '../utils/tenant-query.utils';

@Injectable()
export class BillingAuditLogsRepository {
  constructor(
    @InjectRepository(BillingAuditLogEntity)
    private readonly repository: Repository<BillingAuditLogEntity>,
  ) {}

  async create(dto: Partial<BillingAuditLogEntity>): Promise<BillingAuditLogEntity> {
    const entity = this.repository.create(dto);

    return await this.repository.save(entity);
  }

  async findByInvoiceId(
    invoiceId: string,
    limit: number,
    offset: number,
  ): Promise<{ items: BillingAuditLogEntity[]; total: number }> {
    const [items, total] = await this.repository.findAndCount({
      where: { invoiceId, tenantId: getRequiredTenantId() },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    return { items, total };
  }

  async findByOfferId(
    offerId: string,
    limit: number,
    offset: number,
  ): Promise<{ items: BillingAuditLogEntity[]; total: number }> {
    const [items, total] = await this.repository.findAndCount({
      where: { offerId, tenantId: getRequiredTenantId() },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    return { items, total };
  }

  async findBySupplierInvoiceId(
    supplierInvoiceId: string,
    limit: number,
    offset: number,
  ): Promise<{ items: BillingAuditLogEntity[]; total: number }> {
    const qb = this.repository
      .createQueryBuilder('log')
      .where('log.tenant_id = :tenantId', { tenantId: getRequiredTenantId() })
      .andWhere(`log.context->>'supplierInvoiceId' = :supplierInvoiceId`, { supplierInvoiceId })
      .orderBy('log.created_at', 'DESC')
      .take(limit)
      .skip(offset);

    const [items, total] = await qb.getManyAndCount();

    return { items, total };
  }
}
