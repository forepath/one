import { Injectable } from '@nestjs/common';

import { InvoiceStatus } from '../constants/invoice-status.constants';
import type { InvoiceEntity } from '../entities/invoice.entity';
import { CustomerProfilesRepository } from '../repositories/customer-profiles.repository';
import { InvoiceLineItemsRepository } from '../repositories/invoice-line-items.repository';
import { InvoiceNumberSequencesRepository } from '../repositories/invoice-number-sequences.repository';
import { InvoicesRepository } from '../repositories/invoices.repository';
import { ServicePlansRepository } from '../repositories/service-plans.repository';
import { SubscriptionsRepository } from '../repositories/subscriptions.repository';

import { BillingAuditLogService } from './billing-audit-log.service';
import { BillingIssuerConfigService } from './billing-issuer-config.service';
import { InvoiceEmailService } from './invoice-email.service';
import { InvoicePdfService } from './invoice-pdf.service';
import { resolveInvoicingPeriod } from './invoicing-period.util';
import { resolvePurchaseOrderReference } from './purchase-order-reference.util';

export interface IssueDraftOptions {
  skipNotification?: boolean;
}

@Injectable()
export class InvoiceIssuanceService {
  constructor(
    private readonly invoicesRepository: InvoicesRepository,
    private readonly invoiceLineItemsRepository: InvoiceLineItemsRepository,
    private readonly invoiceNumberSequencesRepository: InvoiceNumberSequencesRepository,
    private readonly customerProfilesRepository: CustomerProfilesRepository,
    private readonly subscriptionsRepository: SubscriptionsRepository,
    private readonly servicePlansRepository: ServicePlansRepository,
    private readonly billingIssuerConfig: BillingIssuerConfigService,
    private readonly invoicePdfService: InvoicePdfService,
    private readonly invoiceEmailService: InvoiceEmailService,
    private readonly auditLog: BillingAuditLogService,
  ) {}

  async issueDraft(invoiceId: string, dueInDays = 14, options?: IssueDraftOptions): Promise<InvoiceEntity> {
    const invoice = await this.invoicesRepository.findByIdOrThrow(invoiceId);

    if (invoice.status !== InvoiceStatus.DRAFT) {
      throw new Error(`Invoice ${invoiceId} is not a draft`);
    }

    this.billingIssuerConfig.assertConfigured();

    const lineItems = await this.invoiceLineItemsRepository.findByInvoiceId(invoiceId);
    const profile = await this.customerProfilesRepository.findByUserId(invoice.userId);

    if (!profile) {
      throw new Error('Customer profile required before issuing invoice');
    }

    const year = new Date().getFullYear();
    const invoiceNumber = await this.invoiceNumberSequencesRepository.nextInvoiceNumber(year);
    const issuedAt = new Date();
    const dueDate = new Date(issuedAt);

    dueDate.setDate(dueDate.getDate() + dueInDays);

    const balanceDue = Math.max(0, Number(invoice.balanceDue));
    const isPromotionalZeroBalance = balanceDue === 0;
    const updated = await this.invoicesRepository.update(invoiceId, {
      invoiceNumber,
      status: isPromotionalZeroBalance ? InvoiceStatus.PAID : InvoiceStatus.ISSUED,
      issuedAt,
      dueDate: isPromotionalZeroBalance ? undefined : dueDate,
      balanceDue,
      paymentProcessor: isPromotionalZeroBalance
        ? undefined
        : (process.env.BILLING_DEFAULT_PAYMENT_PROCESSOR ?? 'stripe'),
    });
    const subscription = invoice.subscriptionId
      ? await this.subscriptionsRepository.findByIdOrThrow(invoice.subscriptionId)
      : null;
    const plan = subscription ? await this.servicePlansRepository.findByIdOrThrow(subscription.planId) : null;
    const pdfStorageKey = await this.invoicePdfService.generateAndStore(
      updated,
      lineItems,
      this.billingIssuerConfig.getConfig(),
      profile,
      resolvePurchaseOrderReference(subscription?.number, subscription?.id),
      resolveInvoicingPeriod(updated, subscription ?? undefined, plan ?? undefined),
    );
    const issued = await this.invoicesRepository.update(invoiceId, { pdfStorageKey });

    await this.auditLog.log({
      process: 'invoice.issue',
      level: 'info',
      message: `Issued invoice ${invoiceNumber}`,
      invoiceId,
      userId: invoice.userId,
      context: { invoiceNumber, totalGross: issued.totalGross },
    });

    if (isPromotionalZeroBalance) {
      await this.auditLog.log({
        process: 'invoice.paid.promotional_zero_balance',
        level: 'info',
        message: `Invoice ${invoiceNumber} marked paid due to promotional zero balance`,
        invoiceId,
        userId: invoice.userId,
        context: { invoiceNumber },
      });
    }

    if (!options?.skipNotification && !isPromotionalZeroBalance) {
      await this.invoiceEmailService.notifyInvoiceIssued(issued, pdfStorageKey);
    }

    return issued;
  }
}
