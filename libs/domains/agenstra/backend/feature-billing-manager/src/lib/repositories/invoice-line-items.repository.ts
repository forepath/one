import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { InvoiceLineItemEntity } from '../entities/invoice-line-item.entity';

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
    return await this.repository.find({
      where: { invoiceId },
      order: { position: 'ASC' },
    });
  }

  async deleteByInvoiceId(invoiceId: string): Promise<void> {
    await this.repository.delete({ invoiceId });
  }
}
