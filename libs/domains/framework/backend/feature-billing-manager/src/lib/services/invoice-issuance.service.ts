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

  async issueDraft(invoiceId: string, dueInDays = 14): Promise<InvoiceEntity> {
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

    const updated = await this.invoicesRepository.update(invoiceId, {
      invoiceNumber,
      status: InvoiceStatus.ISSUED,
      issuedAt,
      dueDate,
      balanceDue: invoice.totalGross,
      paymentProcessor: process.env.BILLING_DEFAULT_PAYMENT_PROCESSOR ?? 'stripe',
    });
    const subscription = await this.subscriptionsRepository.findByIdOrThrow(invoice.subscriptionId);
    const plan = await this.servicePlansRepository.findByIdOrThrow(subscription.planId);
    const pdfStorageKey = await this.invoicePdfService.generateAndStore(
      updated,
      lineItems,
      this.billingIssuerConfig.getConfig(),
      profile,
      resolvePurchaseOrderReference(subscription.number, subscription.id),
      resolveInvoicingPeriod(updated, subscription, plan),
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

    await this.invoiceEmailService.notifyInvoiceIssued(issued, pdfStorageKey);

    return issued;
  }
}
