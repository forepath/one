import { getTenantIdOrDefault } from '@forepath/shared/backend/util-http-context';
import { incrementCounter } from '@forepath/shared/backend/util-otel/metrics';
import { Injectable, Logger, Optional } from '@nestjs/common';

import { InvoiceStatus } from '../constants/invoice-status.constants';
import { BillingNotificationPublisher } from '../notifications/billing-notification.publisher';
import { InvoicesRepository } from '../repositories/invoices.repository';
import { SupplierInvoicesRepository } from '../repositories/supplier-invoices.repository';

import { BillingAuditLogService } from './billing-audit-log.service';

@Injectable()
export class InvoiceOverdueJobHandler {
  private readonly logger = new Logger(InvoiceOverdueJobHandler.name);
  private readonly batchSize = parseInt(process.env.INVOICE_OVERDUE_SCHEDULER_BATCH_SIZE ?? '100', 10);

  constructor(
    private readonly invoicesRepository: InvoicesRepository,
    @Optional() private readonly supplierInvoicesRepository?: SupplierInvoicesRepository,
    @Optional() private readonly billingNotificationPublisher?: BillingNotificationPublisher,
    @Optional() private readonly auditLog?: BillingAuditLogService,
  ) {}

  /** Supplier invoices past their due date (current tenant) become overdue. */
  async markOverdueSupplierInvoices(): Promise<number> {
    const count = (await this.supplierInvoicesRepository?.markOverdueBefore(new Date())) ?? 0;

    if (count > 0) {
      this.logger.log(`Marked ${count} supplier invoice(s) as overdue`);
    }

    return count;
  }

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
      const overdue = await this.invoicesRepository.update(invoiceId, { status: InvoiceStatus.OVERDUE });

      this.billingNotificationPublisher?.publishInvoice('invoice.overdue', overdue);
      await this.auditLog?.log({
        process: 'invoice.overdue',
        level: 'info',
        message: 'Invoice became overdue',
        invoiceId,
        userId: invoice.userId,
        context: { dueDate: due.toISOString(), balanceDue: Number(invoice.balanceDue) },
      });
      incrementCounter('forepath.decabill', 'decabill.invoices.overdue_marked', {
        tenant_id: getTenantIdOrDefault(),
      });
      this.logger.log(`Marked invoice ${invoiceId} as overdue`);
    }
  }
}
