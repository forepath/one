import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { InvoiceVoidDocumentEntity } from '../entities/invoice-void-document.entity';
import { applyUserTenantFilter } from '../utils/tenant-query.utils';

@Injectable()
export class InvoiceVoidDocumentsRepository {
  constructor(
    @InjectRepository(InvoiceVoidDocumentEntity)
    private readonly repository: Repository<InvoiceVoidDocumentEntity>,
  ) {}

  async findByInvoiceId(invoiceId: string): Promise<InvoiceVoidDocumentEntity | null> {
    return await this.repository.findOne({ where: { invoiceId } });
  }

  /**
   * True when the storage key matches a void PDF for an invoice in the current tenant.
   */
  async existsAuthorizedByPdfStorageKey(storageKey: string): Promise<boolean> {
    const qb = this.repository
      .createQueryBuilder('voidDoc')
      .innerJoin('voidDoc.invoice', 'invoice')
      .innerJoin('users', 'user', 'user.id = invoice.user_id')
      .where('voidDoc.pdf_storage_key = :storageKey', { storageKey });

    applyUserTenantFilter(qb, 'user');

    return (await qb.getCount()) > 0;
  }

  async create(dto: {
    invoiceId: string;
    documentNumber: string;
    pdfStorageKey: string;
  }): Promise<InvoiceVoidDocumentEntity> {
    const entity = this.repository.create(dto);

    return await this.repository.save(entity);
  }
}
