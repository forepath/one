import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { ACCOUNTING_POSTING_PORT, type AccountingPostingPort } from '../accounting/ports/accounting-posting.port';
import { InvoiceStatus } from '../constants/invoice-status.constants';
import { SettlementDocumentType, SettlementSource, SettlementType } from '../constants/settlement.constants';
import { BillingEmailPublisher } from '../email/billing-email.publisher';
import type { InvoiceEntity } from '../entities/invoice.entity';
import { PaymentRefundStatus } from '../entities/payment-refund.entity';
import type { SubscriptionEntity } from '../entities/subscription.entity';
import { BillingNotificationPublisher } from '../notifications/billing-notification.publisher';
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
import { creditFromInvoiceSnapshot } from '../utils/credit-snapshot.util';
import { invoiceCountsTowardOssLedger } from '../utils/oss-ledger.util';
import { resolvePlanTaxCategory } from '../utils/plan-tax.utils';
import { resolveSubscriptionBillingBaseOverride } from '../utils/server-type-billing.utils';

import { BillingAuditLogService } from './billing-audit-log.service';
import { BillingIssuerConfigService } from './billing-issuer-config.service';
import { BillingScheduleService } from './billing-schedule.service';
import { DocumentSettlementService } from './document-settlement.service';
import { InvoicePdfService } from './invoice-pdf.service';
import { InvoiceTaxContextService } from './invoice-tax-context.service';
import { resolveInvoicingPeriod } from './invoicing-period.util';
import { OssThresholdService } from './oss-threshold.service';
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
    private readonly invoiceTaxContextService: InvoiceTaxContextService,
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
    private readonly dataSource: DataSource,
    private readonly documentSettlementService: DocumentSettlementService,
    @Optional() private readonly billingNotificationPublisher?: BillingNotificationPublisher,
    @Optional() @Inject(ACCOUNTING_POSTING_PORT) private readonly postingPort?: AccountingPostingPort,
    @Optional() private readonly ossThresholdService?: OssThresholdService,
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

    // Credit from the invoice that was actually issued (its tax snapshot, never more than it charged).
    const snapshotAmounts = await this.capToInvoice(invoice, amounts);
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
      snapshotAmounts.refundNet,
      snapshotAmounts.refundGross,
      lineDescription,
      suffix,
      taxCategory,
    );
    const sourceRef = `withdrawal:${subscription.id}:${withdrawnAt.getTime()}`;
    const settled = await this.dataSource.transaction(async (manager) => {
      const credit = await this.invoiceCreditDocumentsRepository.create(
        {
          invoiceId: invoice.id,
          documentNumber,
          creditNet: snapshotAmounts.refundNet,
          creditGross: snapshotAmounts.refundGross,
          creditTax: Math.round((snapshotAmounts.refundGross - snapshotAmounts.refundNet) * 100) / 100,
          taxRate: snapshotAmounts.taxRate,
          pdfStorageKey: storageKey,
          reason: 'withdrawal',
          withdrawnAt,
          taxCategory,
          description: lineDescription,
          sourceRef,
          settlementComplete: true,
        },
        manager,
      );

      await this.postingPort?.onCreditDocumentCreated(manager, credit.id);

      return await this.documentSettlementService.apply(
        {
          documentType: SettlementDocumentType.INVOICE,
          documentId: invoice.id,
          type: SettlementType.CREDIT,
          amount: snapshotAmounts.refundGross,
          currency: invoice.currency,
          occurredAt: withdrawnAt,
          source: SettlementSource.CREDIT_DOCUMENT,
          sourceRef: `credit:${credit.id}`,
          creditDocumentId: credit.id,
        },
        manager,
      );
    });

    await this.reverseOssShare(invoice, snapshotAmounts.refundNet);
    await this.billingEmailPublisher.publishPartialCreditDocument(
      invoice,
      storageKey,
      documentNumber,
      snapshotAmounts.refundGross,
    );
    this.billingNotificationPublisher?.publishInvoice('invoice.settlement_recorded', settled.document as InvoiceEntity);
    this.billingNotificationPublisher?.publish(
      'credit_note.created',
      {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        creditNoteNumber: documentNumber,
        creditNet: snapshotAmounts.refundNet,
        creditGross: snapshotAmounts.refundGross,
        reason: 'withdrawal',
      },
      invoice.userId,
    );

    let paymentRefundStatus: PaymentRefundOutcome = 'not_applicable';
    // Customer credit left after the credit note (negative balance) is paid back through the processor.
    const customerCredit = Math.max(0, -Number(settled.document.balanceDue));
    const refundPaymentAmount = Math.round(Math.min(snapshotAmounts.refundGross, customerCredit) * 100) / 100;

    if (refundPaymentAmount >= MIN_BILLABLE_AMOUNT) {
      paymentRefundStatus = await this.attemptPaymentRefund(invoice, refundPaymentAmount, withdrawnAt);
    }

    if (settled.becameSettled) {
      const finalInvoice = await this.invoicesRepository.findById(invoice.id);

      if (finalInvoice) {
        this.billingNotificationPublisher?.publishInvoice(
          finalInvoice.status === InvoiceStatus.PAID ? 'invoice.paid' : 'invoice.credited',
          finalInvoice,
        );
      }
    }

    await this.auditLog.log({
      process: 'subscription.withdraw.refund',
      level: 'info',
      message: 'Applied withdrawal partial refund',
      userId: subscription.userId,
      invoiceId: invoice.id,
      context: {
        subscriptionId: subscription.id,
        refundNet: snapshotAmounts.refundNet,
        refundGross: snapshotAmounts.refundGross,
        creditNoteNumber: documentNumber,
        paymentRefundStatus,
      },
    });

    return {
      refundNet: snapshotAmounts.refundNet,
      refundGross: snapshotAmounts.refundGross,
      creditNoteNumber: documentNumber,
      paymentRefundStatus,
    };
  }

  /**
   * Re-prices the credit with the original invoice's tax snapshot (rate of the matching line, or no VAT for
   * zero-rated modes) and caps it at the invoiced net, so a credit never exceeds what was charged.
   */
  /** Credit notes reduce the OSS cross-border B2C total the invoice added. */
  private async reverseOssShare(invoice: InvoiceEntity, creditNet: number): Promise<void> {
    if (this.ossThresholdService && invoice.issuedAt && invoiceCountsTowardOssLedger(invoice)) {
      await this.ossThresholdService.reverseCrossBorderB2cNet({ netAmount: creditNet, at: new Date(invoice.issuedAt) });
    }
  }

  private async capToInvoice(
    invoice: InvoiceEntity,
    amounts: { refundNet: number; refundGross: number },
  ): Promise<{ refundNet: number; refundGross: number; taxRate: number }> {
    const lines = await this.invoiceLineItemsRepository.findByInvoiceId(invoice.id);
    const credit = creditFromInvoiceSnapshot(invoice, lines, amounts.refundNet);

    return { refundNet: credit.net, refundGross: credit.gross, taxRate: credit.taxRate };
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
    const taxContext = await this.invoiceTaxContextService.resolveForUser(subscription.userId);
    const totals = this.taxCalculationService.computeLines(
      [
        {
          description: 'Unused subscription period',
          quantity: 1,
          unitPriceNet: roundedNet,
          taxCategory,
        },
      ],
      {
        taxTreatment: taxContext.treatment,
        forceChargeNonEuIssuerEuB2b: taxContext.forceChargeNonEuIssuerEuB2b,
      },
    );

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
    // Prefer the payment that actually succeeded (auto charges store a PaymentIntent, checkouts a session).
    const externalId = attempt?.externalId ?? checkoutSessionId;

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
      await this.documentSettlementService.apply({
        documentType: SettlementDocumentType.INVOICE,
        documentId: invoice.id,
        type: SettlementType.REFUND,
        amount,
        currency: invoice.currency,
        occurredAt: new Date(),
        source: SettlementSource.PROCESSOR_WEBHOOK,
        sourceRef: `refund:${refundRecord.id}`,
        processor: processorType,
        externalId: result.externalRefundId,
        paymentRefundId: refundRecord.id,
      });
      this.billingNotificationPublisher?.publishPayment(
        'payment.refunded',
        (await this.invoicesRepository.findById(invoice.id)) ?? (invoice as InvoiceEntity),
        { processor: processorType, externalRefundId: result.externalRefundId, amount },
      );

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
