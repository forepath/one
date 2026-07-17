import { Injectable, Logger } from '@nestjs/common';

import { InvoiceStatus } from '../constants/invoice-status.constants';
import type { ServicePlanEntity } from '../entities/service-plan.entity';
import { PaymentRefundStatus } from '../entities/payment-refund.entity';
import type { SubscriptionEntity } from '../entities/subscription.entity';
import { PaymentProcessorFactory } from '../payment-processors/payment-processor.factory';
import { CustomerProfilesRepository } from '../repositories/customer-profiles.repository';
import { InvoiceCreditDocumentsRepository } from '../repositories/invoice-credit-documents.repository';
import { InvoiceLineItemsRepository } from '../repositories/invoice-line-items.repository';
import { InvoicesRepository } from '../repositories/invoices.repository';
import { PaymentAttemptsRepository } from '../repositories/payment-attempts.repository';
import { PaymentRefundsRepository } from '../repositories/payment-refunds.repository';
import { ServicePlansRepository } from '../repositories/service-plans.repository';
import { SubscriptionItemsRepository } from '../repositories/subscription-items.repository';
import { calculateProratedAmount } from '../utils/billing-proration.util';
import { resolvePlanTaxCategory } from '../utils/plan-tax.utils';
import { resolveSubscriptionBillingBaseOverride } from '../utils/server-type-billing.utils';

import { BillingAuditLogService } from './billing-audit-log.service';
import { BillingIssuerConfigService } from './billing-issuer-config.service';
import { BillingScheduleService } from './billing-schedule.service';
import { BillingEmailPublisher } from '../email/billing-email.publisher';
import { InvoicePdfService } from './invoice-pdf.service';
import { resolveInvoicingPeriod } from './invoicing-period.util';
import { PricingService } from './pricing.service';
import { ProviderServerTypesService } from './provider-server-types.service';
import { resolvePurchaseOrderReference } from './purchase-order-reference.util';
import { TaxCalculationService } from './tax-calculation.service';

const MIN_BILLABLE_AMOUNT = 0.01;

export type PaymentRefundOutcome = 'not_applicable' | 'pending' | 'succeeded' | 'failed';

export interface WithdrawalRefundResult {
  refundNet?: number;
  refundGross?: number;
  creditNoteNumber?: string;
  paymentRefundStatus: PaymentRefundOutcome;
}

@Injectable()
export class WithdrawalRefundService {
  private readonly logger = new Logger(WithdrawalRefundService.name);

  constructor(
    private readonly servicePlansRepository: ServicePlansRepository,
    private readonly subscriptionItemsRepository: SubscriptionItemsRepository,
    private readonly providerServerTypesService: ProviderServerTypesService,
    private readonly pricingService: PricingService,
    private readonly billingScheduleService: BillingScheduleService,
    private readonly taxCalculationService: TaxCalculationService,
    private readonly invoicesRepository: InvoicesRepository,
    private readonly invoiceLineItemsRepository: InvoiceLineItemsRepository,
    private readonly invoiceCreditDocumentsRepository: InvoiceCreditDocumentsRepository,
    private readonly paymentAttemptsRepository: PaymentAttemptsRepository,
    private readonly paymentRefundsRepository: PaymentRefundsRepository,
    private readonly paymentProcessorFactory: PaymentProcessorFactory,
    private readonly customerProfilesRepository: CustomerProfilesRepository,
    private readonly billingIssuerConfig: BillingIssuerConfigService,
    private readonly invoicePdfService: InvoicePdfService,
    private readonly billingEmailPublisher: BillingEmailPublisher,
    private readonly auditLog: BillingAuditLogService,
  ) {}

  async estimateRefundGross(subscription: SubscriptionEntity): Promise<number | undefined> {
    const amounts = await this.calculateRefundAmounts(subscription, new Date());

    return amounts?.refundGross;
  }

  async applyProvisionedWithdrawalRefund(
    subscription: SubscriptionEntity,
    withdrawnAt: Date,
  ): Promise<WithdrawalRefundResult> {
    const amounts = await this.calculateRefundAmounts(subscription, withdrawnAt);

    if (!amounts) {
      return { paymentRefundStatus: 'not_applicable' };
    }

    const invoice = await this.invoicesRepository.findLatestBillableBySubscription(subscription.id);

    if (!invoice?.invoiceNumber) {
      return {
        refundNet: amounts.refundNet,
        refundGross: amounts.refundGross,
        paymentRefundStatus: 'not_applicable',
      };
    }

    const suffix = withdrawnAt.getTime().toString(36);
    const lineDescription = `Unused subscription period (${subscription.number})`;
    const buyer = await this.customerProfilesRepository.findByUserId(subscription.userId);

    if (!buyer) {
      throw new Error('Customer profile not found for withdrawal refund');
    }

    const issuer = this.billingIssuerConfig.getConfig();
    const plan = await this.servicePlansRepository.findByIdOrThrow(subscription.planId);
    const taxCategory = resolvePlanTaxCategory(plan);
    const purchaseOrderReference = resolvePurchaseOrderReference(subscription.number, subscription.id);
    const invoicingPeriod = resolveInvoicingPeriod(invoice, subscription, plan);
    const { storageKey, documentNumber } = await this.invoicePdfService.generatePartialCreditDocumentAndStore(
      invoice,
      withdrawnAt,
      issuer,
      buyer,
      purchaseOrderReference,
      invoicingPeriod,
      amounts.refundNet,
      amounts.refundGross,
      lineDescription,
      suffix,
      taxCategory,
    );

    await this.invoiceCreditDocumentsRepository.create({
      invoiceId: invoice.id,
      documentNumber,
      creditNet: amounts.refundNet,
      creditGross: amounts.refundGross,
      pdfStorageKey: storageKey,
      reason: 'withdrawal',
      withdrawnAt,
      taxCategory,
      description: lineDescription,
    });

    await this.billingEmailPublisher.publishPartialCreditDocument(
      invoice,
      storageKey,
      documentNumber,
      amounts.refundGross,
    );

    let paymentRefundStatus: PaymentRefundOutcome = 'not_applicable';
    const creditApplied = Math.min(amounts.refundGross, Number(invoice.balanceDue));

    if (invoice.status === InvoiceStatus.PAID || invoice.status === InvoiceStatus.PARTIALLY_PAID) {
      const paidAmount =
        invoice.status === InvoiceStatus.PAID
          ? Number(invoice.totalGross)
          : Math.max(0, Number(invoice.totalGross) - Number(invoice.balanceDue));
      const refundPaymentAmount = Math.min(amounts.refundGross, paidAmount);

      if (refundPaymentAmount >= MIN_BILLABLE_AMOUNT) {
        paymentRefundStatus = await this.attemptPaymentRefund(invoice, refundPaymentAmount, withdrawnAt);
      }

      const newBalanceDue = Math.max(0, Math.round((Number(invoice.balanceDue) - creditApplied) * 100) / 100);

      await this.invoicesRepository.update(invoice.id, {
        balanceDue: newBalanceDue,
        ...(newBalanceDue <= 0 ? { status: InvoiceStatus.PAID } : {}),
      });
    } else if (invoice.status === InvoiceStatus.ISSUED || invoice.status === InvoiceStatus.OVERDUE) {
      const newBalanceDue = Math.max(0, Math.round((Number(invoice.balanceDue) - creditApplied) * 100) / 100);

      await this.invoicesRepository.update(invoice.id, {
        balanceDue: newBalanceDue,
        ...(newBalanceDue <= 0 ? { status: InvoiceStatus.PAID } : {}),
      });
    }

    await this.auditLog.log({
      process: 'subscription.withdraw.refund',
      level: 'info',
      message: 'Applied withdrawal partial refund',
      userId: subscription.userId,
      invoiceId: invoice.id,
      context: {
        subscriptionId: subscription.id,
        refundNet: amounts.refundNet,
        refundGross: amounts.refundGross,
        creditNoteNumber: documentNumber,
        paymentRefundStatus,
      },
    });

    return {
      refundNet: amounts.refundNet,
      refundGross: amounts.refundGross,
      creditNoteNumber: documentNumber,
      paymentRefundStatus,
    };
  }

  private async calculateRefundAmounts(
    subscription: SubscriptionEntity,
    withdrawnAt: Date,
  ): Promise<{ refundNet: number; refundGross: number } | undefined> {
    const periodEnd = subscription.currentPeriodEnd;

    if (!periodEnd || withdrawnAt >= periodEnd) {
      return undefined;
    }

    const plan = await this.servicePlansRepository.findByIdOrThrow(subscription.planId);
    const items = await this.subscriptionItemsRepository.findBySubscription(subscription.id);
    const basePriceOverride = await resolveSubscriptionBillingBaseOverride(items, this.providerServerTypesService);
    const pricing = this.pricingService.calculate(plan, basePriceOverride);
    const periodStart = subscription.currentPeriodStart ?? subscription.createdAt;
    const refundNet = calculateProratedAmount(
      plan,
      pricing.totalPrice,
      withdrawnAt,
      periodEnd,
      this.billingScheduleService,
    );

    if (refundNet < MIN_BILLABLE_AMOUNT) {
      return undefined;
    }

    const roundedNet = Math.round(refundNet * 100) / 100;
    const taxCategory = resolvePlanTaxCategory(plan);
    const totals = this.taxCalculationService.computeLines([
      {
        description: 'Unused subscription period',
        quantity: 1,
        unitPriceNet: roundedNet,
        taxCategory,
      },
    ]);

    return { refundNet: roundedNet, refundGross: totals.totalGross };
  }

  private async attemptPaymentRefund(
    invoice: { id: string; externalPaymentId?: string; paymentProcessor?: string; currency: string },
    amount: number,
    withdrawnAt: Date,
  ): Promise<PaymentRefundOutcome> {
    const processorType = invoice.paymentProcessor ?? process.env.BILLING_DEFAULT_PAYMENT_PROCESSOR ?? 'stripe';
    const checkoutSessionId = invoice.externalPaymentId;
    const attempt = await this.paymentAttemptsRepository.findLatestSucceededByInvoiceId(invoice.id);
    const externalId = checkoutSessionId ?? attempt?.externalId;

    if (!externalId) {
      this.logger.warn(`No checkout session found for invoice ${invoice.id}; skipping payment refund`);

      return 'failed';
    }

    const refundRecord = await this.paymentRefundsRepository.create({
      invoiceId: invoice.id,
      amount,
      currency: invoice.currency,
      processor: processorType,
      reason: 'withdrawal',
    });

    try {
      const processor = this.paymentProcessorFactory.getProcessor(processorType);
      const result = await processor.refundPayment({
        externalCheckoutSessionId: externalId,
        amount,
        currency: invoice.currency,
        idempotencyKey: `withdraw-refund-${invoice.id}-${withdrawnAt.getTime()}`,
      });

      await this.paymentRefundsRepository.update(refundRecord.id, {
        status: PaymentRefundStatus.SUCCEEDED,
        externalRefundId: result.externalRefundId,
      });

      return 'succeeded';
    } catch (error) {
      this.logger.error(`Payment refund failed for invoice ${invoice.id}: ${(error as Error).message}`);

      await this.paymentRefundsRepository.update(refundRecord.id, {
        status: PaymentRefundStatus.FAILED,
      });

      return 'failed';
    }
  }
}
