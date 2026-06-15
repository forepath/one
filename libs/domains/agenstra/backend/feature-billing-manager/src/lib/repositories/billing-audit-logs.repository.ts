import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { BillingAuditLogEntity } from '../entities/billing-audit-log.entity';

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
      where: { invoiceId },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    return { items, total };
  }
}
