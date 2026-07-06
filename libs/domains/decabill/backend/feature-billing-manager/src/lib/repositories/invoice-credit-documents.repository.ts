import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { InvoiceCreditDocumentEntity } from '../entities/invoice-credit-document.entity';

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
  }): Promise<InvoiceCreditDocumentEntity> {
    const entity = this.repository.create(dto);

    return await this.repository.save(entity);
  }
}
