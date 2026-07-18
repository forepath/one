import { Injectable, Logger } from '@nestjs/common';

import { AutoBillingService } from './auto-billing.service';

@Injectable()
export class InvoiceAutoPaymentJobHandler {
  private readonly logger = new Logger(InvoiceAutoPaymentJobHandler.name);

  constructor(private readonly autoBillingService: AutoBillingService) {}

  get batchSizeLimit(): number {
    return this.autoBillingService.batchSizeLimit;
  }

  async findInvoiceIdsPage(offset: number): Promise<string[]> {
    return await this.autoBillingService.findInvoiceIdsDueForAutoPayment(offset);
  }

  async attemptAutoPayment(invoiceId: string): Promise<void> {
    this.logger.log(`Attempting auto-payment for invoice ${invoiceId}`);
    await this.autoBillingService.attemptAutoPayment(invoiceId);
  }
}
