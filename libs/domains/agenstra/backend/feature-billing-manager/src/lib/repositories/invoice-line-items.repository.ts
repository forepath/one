import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { InvoiceLineItemEntity } from '../entities/invoice-line-item.entity';
import { applyUserTenantFilter } from '../utils/tenant-query.utils';

@Injectable()
export class InvoiceLineItemsRepository {
  constructor(
    @InjectRepository(InvoiceLineItemEntity)
    private readonly repository: Repository<InvoiceLineItemEntity>,
  ) {}

  async createMany(items: Partial<InvoiceLineItemEntity>[]): Promise<InvoiceLineItemEntity[]> {
    const entities = this.repository.create(items);

    return await this.repository.save(entities);
  }

  async findByInvoiceId(invoiceId: string): Promise<InvoiceLineItemEntity[]> {
    const qb = this.repository
      .createQueryBuilder('line')
      .innerJoin('line.invoice', 'inv')
      .innerJoin('users', 'user', 'user.id = inv.user_id')
      .where('line.invoice_id = :invoiceId', { invoiceId })
      .orderBy('line.position', 'ASC');

    applyUserTenantFilter(qb, 'user');

    return await qb.getMany();
  }

  async deleteByInvoiceId(invoiceId: string): Promise<void> {
    const lines = await this.findByInvoiceId(invoiceId);

    if (lines.length === 0) {
      return;
    }

    await this.repository.delete(lines.map((line) => line.id));
  }
}
