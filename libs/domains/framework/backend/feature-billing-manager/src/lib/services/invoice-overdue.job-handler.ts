import { Injectable, Logger } from '@nestjs/common';

import { InvoiceStatus } from '../constants/invoice-status.constants';
import { InvoicesRepository } from '../repositories/invoices.repository';

@Injectable()
export class InvoiceOverdueJobHandler {
  private readonly logger = new Logger(InvoiceOverdueJobHandler.name);
  private readonly batchSize = parseInt(process.env.INVOICE_OVERDUE_SCHEDULER_BATCH_SIZE ?? '100', 10);

  constructor(private readonly invoicesRepository: InvoicesRepository) {}

  async findInvoiceIdsPage(offset: number): Promise<string[]> {
    const refs = await this.invoicesRepository.findBatchForOverdueCheck(this.batchSize, offset);

    return refs.map((ref) => ref.id);
  }

  get batchSizeLimit(): number {
    return this.batchSize;
  }

  async markOverdueIfNeeded(invoiceId: string): Promise<void> {
    const invoice = await this.invoicesRepository.findById(invoiceId);

    if (!invoice) {
      return;
    }

    if (invoice.status !== InvoiceStatus.ISSUED && invoice.status !== InvoiceStatus.PARTIALLY_PAID) {
      return;
    }

    if (!invoice.dueDate) {
      return;
    }

    const due = invoice.dueDate instanceof Date ? invoice.dueDate : new Date(invoice.dueDate);
    const today = new Date();

    today.setHours(0, 0, 0, 0);
    due.setHours(0, 0, 0, 0);

    if (due < today) {
      await this.invoicesRepository.update(invoiceId, { status: InvoiceStatus.OVERDUE });
      this.logger.log(`Marked invoice ${invoiceId} as overdue`);
    }
  }
}
