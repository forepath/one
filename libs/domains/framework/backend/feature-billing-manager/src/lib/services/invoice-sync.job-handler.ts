import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import { InvoiceRefEntity } from '../entities/invoice-ref.entity';
import { InvoiceRefsRepository } from '../repositories/invoice-refs.repository';

import { InvoiceNinjaService } from './invoice-ninja.service';

@Injectable()
export class InvoiceSyncJobHandler {
  private readonly logger = new Logger(InvoiceSyncJobHandler.name);
  private readonly batchSize = parseInt(process.env.INVOICE_SYNC_SCHEDULER_BATCH_SIZE ?? '100', 10);

  constructor(
    private readonly invoiceRefsRepository: InvoiceRefsRepository,
    private readonly invoiceNinjaService: InvoiceNinjaService,
  ) {}

  async findInvoiceRefIdsPage(offset: number): Promise<string[]> {
    const refs = await this.invoiceRefsRepository.findBatchForSync(this.batchSize, offset);

    return refs.map((ref) => ref.id);
  }

  get batchSizeLimit(): number {
    return this.batchSize;
  }

  async syncInvoiceRef(invoiceRefId: string): Promise<void> {
    const ref = await this.invoiceRefsRepository.findById(invoiceRefId);

    if (!ref) {
      throw new NotFoundException(`Invoice ref ${invoiceRefId} not found`);
    }

    await this.syncInvoiceRefEntity(ref);
  }

  private async syncInvoiceRefEntity(ref: InvoiceRefEntity): Promise<void> {
    const details = await this.invoiceNinjaService.getInvoiceDetailsForSync(ref.invoiceNinjaId);

    if (!details) {
      return;
    }

    const updates: Partial<Pick<InvoiceRefEntity, 'status' | 'invoiceNumber' | 'balance' | 'dueDate'>> = {};

    if (details.status !== undefined && details.status !== ref.status) {
      updates.status = details.status;
    }

    if (details.invoiceNumber !== undefined && details.invoiceNumber !== ref.invoiceNumber) {
      updates.invoiceNumber = details.invoiceNumber;
    }

    if (details.balance !== undefined && details.balance !== ref.balance) {
      updates.balance = details.balance;
    }

    if (details.dueDate !== undefined) {
      const same =
        ref.dueDate != null && details.dueDate != null && ref.dueDate.getTime() === details.dueDate.getTime();

      if (!same) {
        updates.dueDate = details.dueDate;
      }
    }

    if (Object.keys(updates).length === 0) {
      return;
    }

    await this.invoiceRefsRepository.update(ref.id, updates);
  }
}
