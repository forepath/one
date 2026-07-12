import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { InvoicePromotionApplicationEntity } from '../entities/invoice-promotion-application.entity';

@Injectable()
export class InvoicePromotionApplicationsRepository {
  constructor(
    @InjectRepository(InvoicePromotionApplicationEntity)
    private readonly repository: Repository<InvoicePromotionApplicationEntity>,
  ) {}

  async createMany(items: Partial<InvoicePromotionApplicationEntity>[]): Promise<InvoicePromotionApplicationEntity[]> {
    const entities = this.repository.create(items);

    return await this.repository.save(entities);
  }

  async findByInvoiceId(invoiceId: string): Promise<InvoicePromotionApplicationEntity[]> {
    return await this.repository.find({
      where: { invoiceId },
      relations: ['redemption', 'redemption.promotion'],
    });
  }

  async hasApplicationsForInvoice(invoiceId: string): Promise<boolean> {
    const count = await this.repository.count({ where: { invoiceId } });

    return count > 0;
  }
}
