import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { InvoiceVoidDocumentEntity } from '../entities/invoice-void-document.entity';

@Injectable()
export class InvoiceVoidDocumentsRepository {
  constructor(
    @InjectRepository(InvoiceVoidDocumentEntity)
    private readonly repository: Repository<InvoiceVoidDocumentEntity>,
  ) {}

  async findByInvoiceId(invoiceId: string): Promise<InvoiceVoidDocumentEntity | null> {
    return await this.repository.findOne({ where: { invoiceId } });
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
