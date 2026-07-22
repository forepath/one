import { Injectable } from '@nestjs/common';

import { InvoiceStatus } from '../constants/invoice-status.constants';
import type { InvoiceEntity } from '../entities/invoice.entity';
import { CustomerProfilesRepository } from '../repositories/customer-profiles.repository';
import { InvoiceLineItemsRepository } from '../repositories/invoice-line-items.repository';
import { InvoiceNumberSequencesRepository } from '../repositories/invoice-number-sequences.repository';
import { InvoicesRepository } from '../repositories/invoices.repository';
import { ServicePlansRepository } from '../repositories/service-plans.repository';
import { SubscriptionsRepository } from '../repositories/subscriptions.repository';

import { AutoBillingService } from './auto-billing.service';
import { BillingAuditLogService } from './billing-audit-log.service';
import { BillingIssuerConfigService } from './billing-issuer-config.service';
import { BillingNotificationPublisher } from '../notifications/billing-notification.publisher';
import { BillingEmailPublisher } from '../email/billing-email.publisher';
import { InvoicePdfService } from './invoice-pdf.service';
import { InvoiceTaxContextService } from './invoice-tax-context.service';
import { OssThresholdService } from './oss-threshold.service';
import { resolveInvoicingPeriod } from './invoicing-period.util';
import { resolvePurchaseOrderReference } from './purchase-order-reference.util';
import { CustomerTrustScoreService } from '../trust-score/customer-trust-score.service';
import { isEuMemberState } from '../constants/eu-member-states.constants';
import { TaxMode } from '../constants/tax-mode.constants';

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
    private readonly billingEmailPublisher: BillingEmailPublisher,
    private readonly auditLog: BillingAuditLogService,
    private readonly billingNotificationPublisher: BillingNotificationPublisher,
    private readonly autoBillingService: AutoBillingService,
    private readonly customerTrustScoreService: CustomerTrustScoreService,
    private readonly invoiceTaxContextService: InvoiceTaxContextService,
    private readonly ossThresholdService: OssThresholdService,
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
      await this.billingEmailPublisher.publishInvoiceIssued(issued, pdfStorageKey);
    }

    this.billingNotificationPublisher.publishInvoice('invoice.issued', issued);

    if (issued.taxMode && issued.taxMode !== TaxMode.DOMESTIC_VAT) {
      this.billingNotificationPublisher.publish(
        'invoice.tax_mode_applied',
        {
          invoiceId: issued.id,
          userId: issued.userId,
          taxMode: issued.taxMode,
          taxCountryCode: issued.taxCountryCode ?? null,
          buyerCountry: issued.buyerCountry ?? null,
        },
        issued.userId,
      );
    }

    const taxContext = await this.invoiceTaxContextService.resolveForUser(invoice.userId);

    if (taxContext.countsTowardOssLedger && isEuMemberState(issued.buyerCountry) && Number(issued.subtotalNet) > 0) {
      await this.ossThresholdService.recordCrossBorderB2cNet({
        netAmount: Number(issued.subtotalNet),
      });
    }

    if (!isPromotionalZeroBalance) {
      await this.autoBillingService.scheduleIfEligible(issued);
    }

    this.customerTrustScoreService.triggerRecomputeForUser(invoice.userId);

    return issued;
  }
}
