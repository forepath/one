import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { ACCOUNTING_POSTING_PORT, type AccountingPostingPort } from '../accounting/ports/accounting-posting.port';
import { InvoiceStatus } from '../constants/invoice-status.constants';
import { SettlementDocumentType, SettlementSource, SettlementType } from '../constants/settlement.constants';
import { BillingEmailPublisher } from '../email/billing-email.publisher';
import type { InvoiceCreditDocumentEntity } from '../entities/invoice-credit-document.entity';
import { InvoiceLineItemEntity } from '../entities/invoice-line-item.entity';
import type { InvoiceEntity } from '../entities/invoice.entity';
import type { ServicePlanEntity } from '../entities/service-plan.entity';
import type {
  SubscriptionConfigChangeBillingOutcome,
  SubscriptionConfigChangeEntity,
} from '../entities/subscription-config-change.entity';
import type { SubscriptionEntity } from '../entities/subscription.entity';
import { BillingNotificationPublisher } from '../notifications/billing-notification.publisher';
import { CustomerProfilesRepository } from '../repositories/customer-profiles.repository';
import { InvoiceCreditDocumentsRepository } from '../repositories/invoice-credit-documents.repository';
import { InvoicesRepository } from '../repositories/invoices.repository';
import { OpenPositionsRepository } from '../repositories/open-positions.repository';
import { SubscriptionsRepository } from '../repositories/subscriptions.repository';
import {
  configChangeCarrySourceRef,
  configChangePrimarySourceRef,
} from '../utils/config-change-billing-source-ref.util';
import { creditFromInvoiceSnapshot } from '../utils/credit-snapshot.util';
import { invoiceCountsTowardOssLedger } from '../utils/oss-ledger.util';
import { resolvePlanTaxCategory } from '../utils/plan-tax.utils';
import { roundMoney } from '../utils/promotion-advantage.util';

import { BillingAuditLogService } from './billing-audit-log.service';
import { BillingIssuerConfigService } from './billing-issuer-config.service';
import { DocumentSettlementService } from './document-settlement.service';
import { InvoicePdfService } from './invoice-pdf.service';
import { InvoiceTaxContextService } from './invoice-tax-context.service';
import { resolveInvoicingPeriod } from './invoicing-period.util';
import { OssThresholdService } from './oss-threshold.service';
import type {
  PeriodPriceChangeBillingOutcome,
  PeriodPriceChangeSettlementParams,
} from './period-price-change-billing.types';
import { PromotionApplicationService } from './promotion-application.service';
import { resolvePurchaseOrderReference } from './purchase-order-reference.util';
import { TaxCalculationService } from './tax-calculation.service';

/** Discriminators written to `billing_open_positions.adjustment_kind` by this service. */
export const CONFIG_CHANGE_ADJUSTMENT_KINDS = {
  /** Elapsed part of a post-usage period settled at the pre-change price. */
  ARREAR: 'config_change_arrear',
  /** Extra amount owed because the new configuration costs more. */
  CHARGE: 'config_change_charge',
  /** Amount owed back to the customer because the new configuration costs less. */
  CREDIT: 'config_change_credit',
} as const;

/** Credit document reason for config-change credits, distinct from statutory withdrawal credits. */
export const CONFIG_CHANGE_CREDIT_REASON = 'config_change';

/** Floor below which an adjustment is not worth a ledger entry. */
const MIN_BILLABLE_AMOUNT = 0.01;

export interface ConfigChangeBillingParams {
  subscription: SubscriptionEntity;
  plan: ServicePlanEntity;
  change: SubscriptionConfigChangeEntity;
  changedAt: Date;
}

/**
 * Settles the money side of an applied subscription configuration change.
 *
 * Amounts come from the disclaimer snapshot frozen when the customer accepted the change, so the
 * customer is never charged something other than what was shown. How the delta is settled depends
 * on the plan's billing direction (preview computes `immediateAdjustmentNet` to match):
 *
 * - post-usage: settle the elapsed share of the old period price, then move the period anchor so
 *   the remainder bills at the new price;
 * - pre-usage, period not invoiced yet: the pending invoice uses the new price for the whole
 *   period, so the frozen adjustment is the elapsed share of the delta corrected out;
 * - pre-usage, period already invoiced: the remaining share of the delta is charged on top, or
 *   credited through a partial credit document.
 */
@Injectable()
export class SubscriptionConfigChangeBillingService {
  private readonly logger = new Logger(SubscriptionConfigChangeBillingService.name);

  constructor(
    private readonly openPositionsRepository: OpenPositionsRepository,
    private readonly subscriptionsRepository: SubscriptionsRepository,
    private readonly invoicesRepository: InvoicesRepository,
    private readonly invoiceCreditDocumentsRepository: InvoiceCreditDocumentsRepository,
    private readonly customerProfilesRepository: CustomerProfilesRepository,
    private readonly taxCalculationService: TaxCalculationService,
    private readonly invoiceTaxContextService: InvoiceTaxContextService,
    private readonly promotionApplicationService: PromotionApplicationService,
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

  async apply(params: ConfigChangeBillingParams): Promise<SubscriptionConfigChangeBillingOutcome> {
    const snapshot = params.change.billingDisclaimerSnapshot;

    if (!snapshot) {
      this.logger.warn(`Config change ${params.change.id} has no disclaimer snapshot; skipping one-shot billing`);

      return 'none';
    }

    return await this.applySettlement(this.buildSettlementParams(params));
  }

  async applySettlement(params: PeriodPriceChangeSettlementParams): Promise<PeriodPriceChangeBillingOutcome> {
    const existingOutcome = await this.findExistingOutcome(params);

    if (existingOutcome) {
      if (params.plan.billInAdvance !== true) {
        await this.resetPeriodAnchor(params.subscription, params.changedAt);
      }

      this.logger.log(
        `${params.auditIdKey} ${params.auditIdValue} already has billing side effects (${existingOutcome}); skipping re-settlement`,
      );

      return existingOutcome;
    }

    const { currentPeriodNet, periodDeltaNet, immediateAdjustmentNet } = params.snapshot;

    if (
      !Number.isFinite(currentPeriodNet) ||
      !Number.isFinite(periodDeltaNet) ||
      !Number.isFinite(immediateAdjustmentNet)
    ) {
      this.logger.warn(
        `${params.auditIdKey} ${params.auditIdValue} has an unusable billing snapshot; skipping billing`,
      );

      return 'none';
    }

    return params.plan.billInAdvance === true
      ? await this.applyPreUsage(params, immediateAdjustmentNet)
      : await this.applyPostUsage(params, immediateAdjustmentNet);
  }

  private buildSettlementParams(params: ConfigChangeBillingParams): PeriodPriceChangeSettlementParams {
    const snapshot = params.change.billingDisclaimerSnapshot;

    return {
      subscription: params.subscription,
      plan: params.plan,
      changedAt: params.changedAt,
      snapshot: {
        currentPeriodNet: Number(snapshot?.currentPeriodNet),
        periodDeltaNet: Number(snapshot?.periodDeltaNet),
        immediateAdjustmentNet: Number(snapshot?.immediateAdjustmentNet),
      },
      primarySourceRef: configChangePrimarySourceRef(params.change.id),
      carrySourceRef: configChangeCarrySourceRef(params.change.id),
      adjustmentKinds: CONFIG_CHANGE_ADJUSTMENT_KINDS,
      creditReason: CONFIG_CHANGE_CREDIT_REASON,
      description: `Configuration change ${params.change.id} (${params.subscription.number})`,
      creditLineDescription: `Configuration change ${params.change.id} credit (${params.subscription.number})`,
      auditProcess: 'subscription.config_change.billing',
      auditIdKey: 'configChangeId',
      auditIdValue: params.change.id,
      legacyConfigChangeId: params.change.id,
    };
  }

  /**
   * Arrear plans invoice the running period after it ends, and pricing is resolved from the live
   * configuration at that time. The one-shot OP locks in the elapsed share at the pre-change price;
   * resetting the period floor then bills the remainder at the new price.
   */
  private async applyPostUsage(
    params: PeriodPriceChangeSettlementParams,
    immediateAdjustmentNet: number,
  ): Promise<PeriodPriceChangeBillingOutcome> {
    const { subscription, changedAt } = params;
    const elapsedNet = roundMoney(immediateAdjustmentNet);
    const gross = await this.computeGross(elapsedNet, params.plan, subscription.userId);

    if (Math.abs(gross) < MIN_BILLABLE_AMOUNT) {
      await this.resetPeriodAnchor(subscription, changedAt);

      return 'none';
    }

    await this.recordAdjustmentPosition(params, elapsedNet, params.adjustmentKinds.ARREAR);
    await this.resetPeriodAnchor(subscription, changedAt);
    await this.logOutcome(params, 'charged', {
      adjustmentNet: elapsedNet,
      kind: params.adjustmentKinds.ARREAR,
    });

    return 'charged';
  }

  private async applyPreUsage(
    params: PeriodPriceChangeSettlementParams,
    immediateAdjustmentNet: number,
  ): Promise<PeriodPriceChangeBillingOutcome> {
    const adjustmentNet = roundMoney(immediateAdjustmentNet);

    if (adjustmentNet < 0) {
      const hasUnbilledPeriodCharge = await this.openPositionsRepository.hasUnbilledPeriodChargeForSubscription(
        params.subscription.id,
      );

      // Unbilled advance period charges already pick up the new price on the pending invoice, so the
      // frozen adjustment is a small elapsed correction (credit for upgrades, charge for downgrades)
      // booked as an OP. Already-invoiced periods need a partial credit document instead; leftover
      // adjustment OPs alone must not take that path.
      if (hasUnbilledPeriodCharge) {
        return await this.settleAdjustment(params, adjustmentNet);
      }

      return await this.applyPartialCredit(params, Math.abs(adjustmentNet));
    }

    return await this.settleAdjustment(params, adjustmentNet);
  }

  /** Books a signed correction as an open position so it lands on the customer's next invoice. */
  private async settleAdjustment(
    params: PeriodPriceChangeSettlementParams,
    adjustmentNet: number,
  ): Promise<PeriodPriceChangeBillingOutcome> {
    const gross = await this.computeGross(adjustmentNet, params.plan, params.subscription.userId);

    if (Math.abs(gross) < MIN_BILLABLE_AMOUNT) {
      return 'none';
    }

    const kind = adjustmentNet < 0 ? params.adjustmentKinds.CREDIT : params.adjustmentKinds.CHARGE;
    const outcome: PeriodPriceChangeBillingOutcome = adjustmentNet < 0 ? 'credited' : 'charged';

    await this.recordAdjustmentPosition(params, adjustmentNet, kind);
    await this.logOutcome(params, outcome, { adjustmentNet, kind });

    return outcome;
  }

  /**
   * Issues a partial credit document against the invoice that already charged the old price
   * (resolved via open-position coverage, including accumulated invoices stamped with another
   * subscription). The credit is capped at the amount the customer effectively paid after
   * promotions, and any part that cannot be taken off an open balance is carried forward as a
   * credit position.
   */
  private async applyPartialCredit(
    params: PeriodPriceChangeSettlementParams,
    creditNetRequested: number,
  ): Promise<PeriodPriceChangeBillingOutcome> {
    const { subscription, plan, changedAt } = params;
    const invoice = await this.invoicesRepository.findLatestBillableBySubscription(subscription.id);

    if (!invoice?.invoiceNumber) {
      return await this.settleAdjustment(params, roundMoney(-creditNetRequested));
    }

    const existingCredit = await this.invoiceCreditDocumentsRepository.findBySourceRef(params.primarySourceRef);

    if (existingCredit) {
      await this.finalizePartialCreditSettlement(params, existingCredit);

      return 'credited';
    }

    const retainedNet = roundMoney(creditNetRequested * (await this.resolvePromotionRetentionRatio(params)));
    const invoiceLines = await this.dataSource
      .getRepository(InvoiceLineItemEntity)
      .find({ where: { invoiceId: invoice.id } });
    const snapshotCredit = creditFromInvoiceSnapshot(invoice, invoiceLines, retainedNet);
    const creditNet = snapshotCredit.net;
    const creditGross = snapshotCredit.gross;

    if (creditGross < MIN_BILLABLE_AMOUNT) {
      return 'none';
    }

    const buyer = await this.customerProfilesRepository.findByUserId(subscription.userId);

    if (!buyer) {
      throw new Error('Customer profile not found for configuration change credit');
    }

    const taxCategory = resolvePlanTaxCategory(plan);
    const { storageKey, documentNumber } = await this.invoicePdfService.generatePartialCreditDocumentAndStore(
      invoice,
      changedAt,
      this.billingIssuerConfig.getConfig(),
      buyer,
      resolvePurchaseOrderReference(subscription.number, subscription.id),
      resolveInvoicingPeriod(invoice, subscription, plan),
      creditNet,
      creditGross,
      params.creditLineDescription,
      changedAt.getTime().toString(36),
      taxCategory,
    );
    const { created, entity: credit } = await this.invoiceCreditDocumentsRepository.createUniqueBySourceRef({
      invoiceId: invoice.id,
      documentNumber,
      creditNet,
      creditGross,
      creditTax: snapshotCredit.tax,
      taxRate: snapshotCredit.taxRate,
      pdfStorageKey: storageKey,
      reason: params.creditReason,
      withdrawnAt: changedAt,
      taxCategory,
      description: params.creditLineDescription,
      sourceRef: params.primarySourceRef,
    });

    if (!created) {
      await this.finalizePartialCreditSettlement(params, credit);

      return 'credited';
    }

    await this.billingEmailPublisher.publishPartialCreditDocument(invoice, storageKey, documentNumber, creditGross);
    this.billingNotificationPublisher?.publish(
      'credit_note.created',
      {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        creditNoteNumber: documentNumber,
        creditNet,
        creditGross,
        reason: params.creditReason,
      },
      invoice.userId,
    );

    if (this.ossThresholdService && invoice.issuedAt && invoiceCountsTowardOssLedger(invoice)) {
      await this.ossThresholdService.reverseCrossBorderB2cNet({ netAmount: creditNet, at: new Date(invoice.issuedAt) });
    }

    const { carriedGross } = await this.finalizePartialCreditSettlement(params, credit);

    await this.logOutcome(params, 'credited', {
      creditNet,
      creditGross,
      creditNoteNumber: documentNumber,
      invoiceId: invoice.id,
      carriedGross,
    });

    return 'credited';
  }

  /**
   * Applies invoice balance reduction and any carry-forward OP inside a transaction so retries
   * can finish settlement after the credit row was persisted.
   */
  private async finalizePartialCreditSettlement(
    params: PeriodPriceChangeSettlementParams,
    credit: InvoiceCreditDocumentEntity,
  ): Promise<{ appliedGross: number; carriedGross: number }> {
    // The full credit note settles the invoice; whatever exceeds the open balance stays on it as customer credit
    // (negative balance) and is applied to the customer's next invoice. No negative revenue line is created, so
    // revenue and VAT are reduced exactly once (by the credit note).
    const result = await this.dataSource.transaction(async (manager) => {
      const lockedCredit = await this.invoiceCreditDocumentsRepository.findByIdForUpdate(credit.id, manager);

      if (!lockedCredit || lockedCredit.settlementComplete) {
        return null;
      }

      await this.postingPort?.onCreditDocumentCreated(manager, lockedCredit.id);

      const creditGross = Number(lockedCredit.creditGross);
      const applied = await this.documentSettlementService.apply(
        {
          documentType: SettlementDocumentType.INVOICE,
          documentId: lockedCredit.invoiceId,
          type: SettlementType.CREDIT,
          amount: creditGross,
          occurredAt: new Date(lockedCredit.withdrawnAt),
          source: SettlementSource.CREDIT_DOCUMENT,
          sourceRef: `credit:${lockedCredit.id}`,
          creditDocumentId: lockedCredit.id,
        },
        manager,
      );

      await this.invoiceCreditDocumentsRepository.markSettlementComplete(lockedCredit.id, manager);

      return { applied, creditGross };
    });

    if (!result) {
      return { appliedGross: 0, carriedGross: 0 };
    }

    const carriedGross = roundMoney(Math.max(0, -Number(result.applied.document.balanceDue)));

    if (result.applied.becameSettled) {
      this.billingNotificationPublisher?.publishInvoice(
        result.applied.document.status === InvoiceStatus.PAID ? 'invoice.paid' : 'invoice.credited',
        result.applied.document as InvoiceEntity,
      );
    }

    return { appliedGross: roundMoney(result.creditGross - carriedGross), carriedGross };
  }

  /**
   * Share of a period charge the customer actually pays once running promotions are applied.
   * Crediting the undiscounted amount would hand back more than was ever invoiced.
   */
  private async resolvePromotionRetentionRatio(params: PeriodPriceChangeSettlementParams): Promise<number> {
    const currentPeriodNet = Number(params.snapshot.currentPeriodNet ?? 0);

    if (!Number.isFinite(currentPeriodNet) || currentPeriodNet <= 0) {
      return 1;
    }

    const taxCategory = resolvePlanTaxCategory(params.plan);
    const promotions = await this.promotionApplicationService.calculatePromotions({
      userId: params.subscription.userId,
      subscriptionId: params.subscription.id,
      chargeLines: [
        {
          description: 'Subscription period',
          quantity: 1,
          unitPriceNet: currentPeriodNet,
          taxCategory,
        },
      ],
      defaultTaxCategory: taxCategory,
      subscriptionChargeNet: currentPeriodNet,
      ...(params.subscription.currentPeriodStart && params.subscription.currentPeriodEnd
        ? {
            chargePeriod: {
              start: params.subscription.currentPeriodStart,
              end: params.subscription.currentPeriodEnd,
            },
          }
        : {}),
    });

    if (promotions.rawSubtotalNet <= 0) {
      return 1;
    }

    return Math.min(1, Math.max(0, promotions.adjustedSubtotalNet / promotions.rawSubtotalNet));
  }

  private async recordAdjustmentPosition(
    params: PeriodPriceChangeSettlementParams,
    adjustmentNet: number,
    adjustmentKind: string,
    sourceRef: string = params.primarySourceRef,
  ): Promise<void> {
    await this.openPositionsRepository.createUniqueBySourceRef({
      subscriptionId: params.subscription.id,
      userId: params.subscription.userId,
      description: params.description,
      billUntil: params.changedAt,
      skipIfNoBillableAmount: true,
      adjustmentNet: adjustmentNet.toFixed(4),
      adjustmentKind,
      sourceRef,
    });
  }

  /**
   * Idempotency guard: if an open position or credit document for this change already exists
   * (even after the position was invoiced), do not settle again.
   */
  private async findExistingOutcome(
    params: PeriodPriceChangeSettlementParams,
  ): Promise<PeriodPriceChangeBillingOutcome | null> {
    const credit = await this.invoiceCreditDocumentsRepository.findBySourceRef(params.primarySourceRef);

    if (credit) {
      if (credit.settlementComplete) {
        return 'credited';
      }

      await this.finalizePartialCreditSettlement(params, credit);

      return 'credited';
    }

    const primaryPosition = await this.openPositionsRepository.findBySourceRef(params.primarySourceRef);

    if (primaryPosition?.subscriptionId === params.subscription.id) {
      return this.deriveOutcomeFromOpenPosition(primaryPosition);
    }

    const carryPosition = await this.openPositionsRepository.findBySourceRef(params.carrySourceRef);

    if (carryPosition?.subscriptionId === params.subscription.id) {
      return 'credited';
    }

    if (!params.legacyConfigChangeId) {
      return null;
    }

    const matching = await this.openPositionsRepository.findConfigChangeAdjustment(
      params.subscription.id,
      params.legacyConfigChangeId,
    );

    if (matching) {
      return this.deriveOutcomeFromOpenPosition(matching);
    }

    const legacyCredit = await this.invoiceCreditDocumentsRepository.findConfigChangeCredit(
      params.legacyConfigChangeId,
    );

    if (legacyCredit) {
      return 'credited';
    }

    return null;
  }

  private deriveOutcomeFromOpenPosition(position: {
    adjustmentNet?: string | null;
    adjustmentKind?: string | null;
  }): PeriodPriceChangeBillingOutcome {
    const net = Number(position.adjustmentNet ?? 0);

    if (net < 0) {
      return 'credited';
    }

    if (Math.abs(net) < MIN_BILLABLE_AMOUNT) {
      return 'none';
    }

    return 'charged';
  }

  /**
   * Moves the charge floor to the change instant so the next regular invoice only prices the
   * period after the change at the new configuration.
   */
  private async resetPeriodAnchor(subscription: SubscriptionEntity, changedAt: Date): Promise<void> {
    await this.subscriptionsRepository.update(subscription.id, { currentPeriodStart: changedAt });
  }

  private async computeGross(net: number, plan: ServicePlanEntity, userId: string): Promise<number> {
    const taxContext = await this.invoiceTaxContextService.resolveForUser(userId);

    return this.taxCalculationService.computeLines(
      [
        {
          description: 'Configuration change adjustment',
          quantity: 1,
          unitPriceNet: net,
          taxCategory: resolvePlanTaxCategory(plan),
        },
      ],
      {
        taxTreatment: taxContext.treatment,
        forceChargeNonEuIssuerEuB2b: taxContext.forceChargeNonEuIssuerEuB2b,
      },
    ).totalGross;
  }

  private async logOutcome(
    params: PeriodPriceChangeSettlementParams,
    outcome: PeriodPriceChangeBillingOutcome,
    context: Record<string, unknown>,
  ): Promise<void> {
    await this.auditLog.log({
      process: params.auditProcess,
      level: 'info',
      message: `Settled period price change with outcome ${outcome}`,
      userId: params.subscription.userId,
      context: {
        subscriptionId: params.subscription.id,
        [params.auditIdKey]: params.auditIdValue,
        outcome,
        ...context,
      },
    });
  }
}
