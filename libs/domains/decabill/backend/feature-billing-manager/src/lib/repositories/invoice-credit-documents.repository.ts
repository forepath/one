import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { TaxCategory } from '../constants/tax-category.constants';
import { InvoiceCreditDocumentEntity } from '../entities/invoice-credit-document.entity';
import { applyUserTenantFilter } from '../utils/tenant-query.utils';

@Injectable()
export class InvoiceCreditDocumentsRepository {
  constructor(
    @InjectRepository(InvoiceCreditDocumentEntity)
    private readonly repository: Repository<InvoiceCreditDocumentEntity>,
  ) {}

  async findByInvoiceId(invoiceId: string): Promise<InvoiceCreditDocumentEntity[]> {
    return await this.repository.find({ where: { invoiceId }, order: { createdAt: 'DESC' } });
  }

  async create(dto: {
    invoiceId: string;
    documentNumber: string;
    creditNet: number;
    creditGross: number;
    pdfStorageKey: string;
    reason: string;
    withdrawnAt: Date;
    taxCategory?: TaxCategory;
    description?: string;
  }): Promise<InvoiceCreditDocumentEntity> {
    const entity = this.repository.create({
      taxCategory: TaxCategory.STANDARD,
      description: '',
      ...dto,
    });

    return await this.repository.save(entity);
  }

  async findWithdrawnInPeriod(from: Date, to: Date): Promise<InvoiceCreditDocumentEntity[]> {
    const qb = this.repository
      .createQueryBuilder('credit')
      .innerJoinAndSelect('credit.invoice', 'invoice')
      .innerJoin('users', 'user', 'user.id = invoice.user_id')
      .leftJoinAndSelect('invoice.lineItems', 'lineItems')
      .where('credit.withdrawn_at >= :from', { from })
      .andWhere('credit.withdrawn_at <= :to', { to })
      .orderBy('credit.withdrawn_at', 'ASC');

    applyUserTenantFilter(qb, 'user');

    return await qb.getMany();
  }
}
