import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import { getMinCheckoutPaymentAmount } from '../constants/payment-amount.constants';
import type { OpenPositionEntity } from '../entities/open-position.entity';
import { BillingIntervalType } from '../entities/service-plan.entity';
import type { ServicePlanEntity } from '../entities/service-plan.entity';
import type { SubscriptionEntity } from '../entities/subscription.entity';
import { InvoicesRepository } from '../repositories/invoices.repository';
import { OpenPositionsRepository } from '../repositories/open-positions.repository';
import { ServicePlansRepository } from '../repositories/service-plans.repository';
import { SubscriptionAddonsRepository } from '../repositories/subscription-addons.repository';
import { SubscriptionsRepository } from '../repositories/subscriptions.repository';
import { SubscriptionItemsRepository } from '../repositories/subscription-items.repository';
import { UsageRecordsRepository } from '../repositories/usage-records.repository';
import { calculateProratedAmount } from '../utils/billing-proration.util';
import { groupOpenPositionsBySubscription } from '../utils/open-position-grouping.util';
import { resolveSubscriptionBillingBaseOverride } from '../utils/server-type-billing.utils';
import { resolvePlanTaxCategory } from '../utils/plan-tax.utils';

import type { LineItemInput } from './tax-calculation.service';
import { TaxCalculationService } from './tax-calculation.service';
import { InvoiceService } from './invoice.service';
import { InvoiceTaxContextService } from './invoice-tax-context.service';
import { PricingService } from './pricing.service';
import { PromotionApplicationService, type PromotionRedemptionUpdate } from './promotion-application.service';
import { ProviderServerTypesService } from './provider-server-types.service';
import { BillingScheduleService } from './billing-schedule.service';
import { MeterBillingService, type MeterChargeLine } from './meter-billing.service';
import { SubscriptionChargePeriodService, type SubscriptionChargePeriod } from './subscription-charge-period.service';
import type { InvoicePromotionApplicationDraft } from '../dto/promotion.dto';

interface InvoiceCreationOptions {
  billUntil?: Date;
  skipIfNoBillableAmount?: boolean;
}

type ChargePeriodResult = SubscriptionChargePeriod;

/** Floor for treating a charge period as billable at all (not the checkout payment minimum). */
const MIN_BILLABLE_AMOUNT = 0.01;

@Injectable()
export class InvoiceCreationService {
  private readonly logger = new Logger(InvoiceCreationService.name);

  constructor(
    private readonly subscriptionsRepository: SubscriptionsRepository,
    private readonly servicePlansRepository: ServicePlansRepository,
    private readonly pricingService: PricingService,
    private readonly invoiceService: InvoiceService,
    private readonly usageRecordsRepository: UsageRecordsRepository,
    private readonly openPositionsRepository: OpenPositionsRepository,
    private readonly subscriptionItemsRepository: SubscriptionItemsRepository,
    private readonly providerServerTypesService: ProviderServerTypesService,
    private readonly promotionApplicationService: PromotionApplicationService,
    private readonly subscriptionChargePeriodService: SubscriptionChargePeriodService,
    private readonly taxCalculationService: TaxCalculationService,
    private readonly invoiceTaxContextService: InvoiceTaxContextService,
    private readonly subscriptionAddonsRepository: SubscriptionAddonsRepository,
    private readonly billingScheduleService: BillingScheduleService,
    private readonly meterBillingService: MeterBillingService,
  ) {}

  async createInvoice(subscriptionId: string, userId: string, description?: string, options?: InvoiceCreationOptions) {
    const subscription = await this.subscriptionsRepository.findByIdOrThrow(subscriptionId);

    if (subscription.userId !== userId) {
      throw new BadRequestException('Subscription does not belong to user');
    }

    const plan = await this.servicePlansRepository.findByIdOrThrow(subscription.planId);
    const pricing = await this.resolveSubscriptionPricing(subscriptionId, plan);
    const billUntil = options?.billUntil ?? new Date();
    const chargePeriod = await this.subscriptionChargePeriodService.resolveChargePeriod(
      subscription,
      plan,
      pricing.totalPrice,
      billUntil,
    );

    if (!chargePeriod) {
      if (options?.skipIfNoBillableAmount) {
        return undefined;
      }

      throw new BadRequestException('No billable amount since last invoice');
    }

    const hasMeterAttachments = await this.meterBillingService.hasAnyMeterAttachments(subscription, plan.serviceTypeId);
    const usageCost =
      plan.billInAdvance === true || hasMeterAttachments
        ? 0
        : this.extractUsageCost(
            (await this.usageRecordsRepository.findLatestForSubscription(subscriptionId))?.usagePayload ?? {},
          );
    const meterLines = hasMeterAttachments
      ? await this.meterBillingService.buildMeterChargeLines({
          subscription,
          plan,
          periodStart: chargePeriod.meterPeriodStart,
          periodEnd: chargePeriod.periodEnd,
        })
      : [];
    const meterTotal = meterLines.reduce((sum, line) => sum + line.unitPriceNet, 0);
    const total = chargePeriod.baseAmount + usageCost + meterTotal;

    if (total < MIN_BILLABLE_AMOUNT) {
      if (options?.skipIfNoBillableAmount) {
        return undefined;
      }

      throw new BadRequestException('No billable amount since last invoice');
    }

    const roundedTotal = Math.round((chargePeriod.baseAmount + usageCost) * 100) / 100;
    const taxCategory = resolvePlanTaxCategory(plan);
    const chargeLine = {
      description: description || 'Subscription charge',
      quantity: 1,
      unitPriceNet: roundedTotal,
      taxCategory,
    };
    const billableAddons = await this.subscriptionAddonsRepository.findBillableBySubscriptionId(subscriptionId);
    const addonChargeLines = billableAddons
      .map((row) => {
        const fullAddonPrice = Number(row.unitPriceSnapshot ?? 0);

        if (!Number.isFinite(fullAddonPrice) || fullAddonPrice <= 0) {
          return null;
        }

        const prorated = calculateProratedAmount(
          plan,
          fullAddonPrice,
          chargePeriod.periodStart,
          chargePeriod.periodEnd,
          this.billingScheduleService,
        );

        if (prorated < MIN_BILLABLE_AMOUNT) {
          return null;
        }

        return {
          description: `Addon: ${row.addonNameSnapshot}`,
          quantity: 1,
          unitPriceNet: Math.round(prorated * 100) / 100,
          taxCategory,
        };
      })
      .filter((line): line is NonNullable<typeof line> => line != null);
    const meterChargeLines = this.mapMeterLinesToInputs(meterLines, taxCategory);

    const promoResult = await this.promotionApplicationService.calculatePromotions({
      userId,
      subscriptionId,
      chargeLines: [chargeLine, ...addonChargeLines, ...meterChargeLines],
      defaultTaxCategory: taxCategory,
      chargePeriod: { start: chargePeriod.periodStart, end: chargePeriod.periodEnd },
      subscriptionChargeNet: Math.round(chargePeriod.baseAmount * 100) / 100,
    });
    const lineInputs = [...promoResult.discountLines, chargeLine, ...addonChargeLines, ...meterChargeLines];
    const taxContext = await this.invoiceTaxContextService.resolveForUser(userId);
    const totals = this.taxCalculationService.computeLines(lineInputs, {
      taxTreatment: taxContext.treatment,
      forceChargeNonEuIssuerEuB2b: taxContext.forceChargeNonEuIssuerEuB2b,
    });
    const minCheckoutPaymentAmount = getMinCheckoutPaymentAmount();

    // Align with accumulate/hold: do not issue positive balances below the Checkout minimum.
    if (totals.totalGross > 0 && totals.totalGross < minCheckoutPaymentAmount) {
      if (options?.skipIfNoBillableAmount) {
        this.logger.debug(
          `Skipping invoice for subscription ${subscriptionId}: payable amount ${totals.totalGross.toFixed(2)} is below minimum ${minCheckoutPaymentAmount.toFixed(2)}`,
        );

        return undefined;
      }

      throw new BadRequestException(
        `Invoice amount is below the minimum payment amount of ${minCheckoutPaymentAmount.toFixed(2)}`,
      );
    }

    return await this.issueInvoiceWithPromotionCommit({
      subscriptionId,
      userId,
      lineInputs,
      promotionApplications: promoResult.applications,
      redemptionUpdates: promoResult.redemptionUpdates,
    });
  }

  async createAccumulatedInvoice(
    userId: string,
    positions: OpenPositionEntity[],
  ): Promise<{ invoiceRefId: string } | undefined> {
    if (positions.length === 0) {
      return undefined;
    }

    const adjustmentPositions = positions.filter((position) => this.parseAdjustmentNet(position) != null);
    const groups = groupOpenPositionsBySubscription(
      positions.filter((position) => this.parseAdjustmentNet(position) == null),
    );
    const billableGroups: {
      group: (typeof groups)[number];
      chargePeriod: ChargePeriodResult;
      amount: number;
      meterLines: MeterChargeLine[];
    }[] = [];

    for (const group of groups) {
      if (group.representative.userId !== userId) {
        throw new BadRequestException('Position does not belong to user');
      }

      const charge = await this.getBillableChargeForPosition(group.representative);

      if (charge && charge.amount >= MIN_BILLABLE_AMOUNT) {
        billableGroups.push({
          group,
          chargePeriod: charge.chargePeriod,
          amount: charge.amount,
          meterLines: charge.meterLines,
        });
      }
    }

    const adjustmentLines = await this.buildAdjustmentLines(adjustmentPositions, userId);
    const recurringTotal = billableGroups.reduce((sum, entry) => sum + entry.amount, 0);
    const adjustmentTotal = adjustmentLines.reduce((sum, line) => sum + line.unitPriceNet, 0);

    if (billableGroups.length === 0 && adjustmentLines.length === 0) {
      return undefined;
    }

    if (Math.abs(Math.round((recurringTotal + adjustmentTotal) * 100) / 100) < MIN_BILLABLE_AMOUNT) {
      return undefined;
    }

    const lineInputs: LineItemInput[] = [];
    const promotionApplications: InvoicePromotionApplicationDraft[] = [];
    const redemptionUpdates: PromotionRedemptionUpdate[] = [];

    for (const { group, amount, chargePeriod, meterLines } of billableGroups) {
      const subscription = await this.subscriptionsRepository.findByIdOrThrow(group.subscriptionId);
      const plan = await this.servicePlansRepository.findByIdOrThrow(subscription.planId);
      const taxCategory = resolvePlanTaxCategory(plan);
      const billableAddons = await this.subscriptionAddonsRepository.findBillableBySubscriptionId(group.subscriptionId);
      const addonChargeLines = billableAddons
        .map((row) => {
          const fullAddonPrice = Number(row.unitPriceSnapshot ?? 0);

          if (!Number.isFinite(fullAddonPrice) || fullAddonPrice <= 0) {
            return null;
          }

          const prorated = calculateProratedAmount(
            plan,
            fullAddonPrice,
            chargePeriod.periodStart,
            chargePeriod.periodEnd,
            this.billingScheduleService,
          );

          if (prorated < MIN_BILLABLE_AMOUNT) {
            return null;
          }

          return {
            description: `Addon: ${row.addonNameSnapshot}`,
            quantity: 1,
            unitPriceNet: Math.round(prorated * 100) / 100,
            taxCategory,
          };
        })
        .filter((line): line is NonNullable<typeof line> => line != null);
      const meterChargeLines = this.mapMeterLinesToInputs(meterLines, taxCategory);
      const addonTotal = addonChargeLines.reduce((sum, line) => sum + line.unitPriceNet, 0);
      const meterTotal = meterChargeLines.reduce((sum, line) => sum + line.unitPriceNet, 0);
      const planAmount = Math.max(0, Math.round((amount - addonTotal - meterTotal) * 100) / 100);
      const chargeLine = {
        description: group.representative.description ?? 'Subscription',
        quantity: 1,
        unitPriceNet: planAmount,
        taxCategory,
      };
      const promoResult = await this.promotionApplicationService.calculatePromotions({
        userId,
        subscriptionId: group.subscriptionId,
        chargeLines: [chargeLine, ...addonChargeLines, ...meterChargeLines],
        defaultTaxCategory: taxCategory,
        chargePeriod: { start: chargePeriod.periodStart, end: chargePeriod.periodEnd },
        subscriptionChargeNet: Math.round(chargePeriod.baseAmount * 100) / 100,
      });

      lineInputs.push(...promoResult.discountLines, chargeLine, ...addonChargeLines, ...meterChargeLines);
      promotionApplications.push(...promoResult.applications);
      redemptionUpdates.push(...promoResult.redemptionUpdates);
    }

    lineInputs.push(...adjustmentLines);

    const primarySubscriptionId = billableGroups[0]?.group.subscriptionId ?? adjustmentPositions[0].subscriptionId;
    const taxContext = await this.invoiceTaxContextService.resolveForUser(userId);
    const totals = this.taxCalculationService.computeLines(lineInputs, {
      taxTreatment: taxContext.treatment,
      forceChargeNonEuIssuerEuB2b: taxContext.forceChargeNonEuIssuerEuB2b,
    });
    const minCheckoutPaymentAmount = getMinCheckoutPaymentAmount();

    // A credit-heavy run must not become a negative invoice; hold the positions so the credit
    // nets against the next charge instead.
    if (totals.totalGross < 0) {
      this.logger.debug(
        `Holding open positions for user ${userId}: credits exceed charges by ${Math.abs(totals.totalGross).toFixed(2)}`,
      );

      return undefined;
    }

    // Hold unbilled positions when there is a positive payable amount below the Checkout minimum.
    // Zero-gross (e.g. fully promotional) invoices are still issued.
    if (totals.totalGross > 0 && totals.totalGross < minCheckoutPaymentAmount) {
      this.logger.debug(
        `Holding open positions for user ${userId}: payable amount ${totals.totalGross.toFixed(2)} is below minimum ${minCheckoutPaymentAmount.toFixed(2)}`,
      );

      return undefined;
    }

    const result = await this.issueInvoiceWithPromotionCommit({
      subscriptionId: primarySubscriptionId,
      userId,
      lineInputs,
      promotionApplications,
      redemptionUpdates,
    });
    const positionIds = [
      ...billableGroups.flatMap(({ group }) => group.positions.map((position) => position.id)),
      ...adjustmentPositions.map((position) => position.id),
    ];

    await this.openPositionsRepository.markManyBilled(positionIds, result.invoiceRefId);

    return { invoiceRefId: result.invoiceRefId };
  }

  async getUnbilledTotalForUser(userId: string): Promise<number> {
    const positions = await this.openPositionsRepository.findUnbilledByUserId(userId);
    const groups = groupOpenPositionsBySubscription(
      positions.filter((position) => this.parseAdjustmentNet(position) == null),
    );
    let total = positions.reduce((sum, position) => sum + (this.parseAdjustmentNet(position) ?? 0), 0);

    for (const group of groups) {
      const netTotal = await this.getBillableNetTotalAfterPromotionsForPosition(group.representative, userId);

      if (netTotal >= MIN_BILLABLE_AMOUNT) {
        total += netTotal;
      }
    }

    return Math.round(total * 100) / 100;
  }

  /**
   * Signed corrections (e.g. mid-life configuration changes) carry their own frozen amount and
   * bypass period pricing, which would otherwise reprice them at the current configuration.
   */
  private async buildAdjustmentLines(positions: OpenPositionEntity[], userId: string): Promise<LineItemInput[]> {
    const lines: LineItemInput[] = [];

    for (const position of positions) {
      if (position.userId !== userId) {
        throw new BadRequestException('Position does not belong to user');
      }

      const amount = this.parseAdjustmentNet(position);

      if (amount == null || Math.abs(amount) < MIN_BILLABLE_AMOUNT) {
        continue;
      }

      const subscription = await this.subscriptionsRepository.findByIdOrThrow(position.subscriptionId);
      const plan = await this.servicePlansRepository.findByIdOrThrow(subscription.planId);

      lines.push({
        description: position.description ?? 'Adjustment',
        quantity: 1,
        unitPriceNet: Math.round(amount * 100) / 100,
        taxCategory: resolvePlanTaxCategory(plan),
      });
    }

    return lines;
  }

  private parseAdjustmentNet(position: OpenPositionEntity): number | null {
    if (position.adjustmentNet == null) {
      return null;
    }

    const parsed = Number(position.adjustmentNet);

    return Number.isFinite(parsed) ? parsed : null;
  }

  private async getBillableNetTotalAfterPromotionsForPosition(
    position: OpenPositionEntity,
    userId: string,
  ): Promise<number> {
    const charge = await this.getBillableChargeForPosition(position);

    if (!charge) {
      return 0;
    }

    const subscription = await this.subscriptionsRepository.findByIdOrThrow(position.subscriptionId);
    const plan = await this.servicePlansRepository.findByIdOrThrow(subscription.planId);
    const taxCategory = resolvePlanTaxCategory(plan);
    const chargeLine = {
      description: position.description ?? 'Subscription',
      quantity: 1,
      unitPriceNet: Math.round(charge.amount * 100) / 100,
      taxCategory,
    };
    const promoResult = await this.promotionApplicationService.calculatePromotions({
      userId,
      subscriptionId: position.subscriptionId,
      chargeLines: [chargeLine],
      defaultTaxCategory: taxCategory,
      chargePeriod: { start: charge.chargePeriod.periodStart, end: charge.chargePeriod.periodEnd },
      subscriptionChargeNet: Math.round(charge.chargePeriod.baseAmount * 100) / 100,
    });

    return promoResult.adjustedSubtotalNet;
  }

  private async getBillableChargeForPosition(
    position: OpenPositionEntity,
  ): Promise<{ amount: number; chargePeriod: ChargePeriodResult; meterLines: MeterChargeLine[] } | null> {
    const subscription = await this.subscriptionsRepository.findByIdOrThrow(position.subscriptionId);

    if (subscription.userId !== position.userId) {
      throw new BadRequestException('Subscription does not belong to user');
    }

    const plan = await this.servicePlansRepository.findByIdOrThrow(subscription.planId);
    const pricing = await this.resolveSubscriptionPricing(position.subscriptionId, plan);
    const billableAddons = await this.subscriptionAddonsRepository.findBillableBySubscriptionId(
      position.subscriptionId,
    );
    const addonsFullPeriod = billableAddons.reduce((sum, row) => {
      const price = Number(row.unitPriceSnapshot ?? 0);

      return sum + (Number.isFinite(price) && price > 0 ? price : 0);
    }, 0);
    const chargePeriod = await this.subscriptionChargePeriodService.resolveChargePeriod(
      subscription,
      plan,
      pricing.totalPrice + addonsFullPeriod,
      position.billUntil,
    );

    if (!chargePeriod) {
      if (position.skipIfNoBillableAmount) {
        return null;
      }

      throw new BadRequestException('No billable amount since last invoice');
    }

    const hasMeterAttachments = await this.meterBillingService.hasAnyMeterAttachments(subscription, plan.serviceTypeId);
    const usageCost =
      plan.billInAdvance === true || hasMeterAttachments
        ? 0
        : this.extractUsageCost(
            (await this.usageRecordsRepository.findLatestForSubscription(position.subscriptionId))?.usagePayload ?? {},
          );
    const meterLines = hasMeterAttachments
      ? await this.meterBillingService.buildMeterChargeLines({
          subscription,
          plan,
          periodStart: chargePeriod.meterPeriodStart,
          periodEnd: chargePeriod.periodEnd,
        })
      : [];
    const meterTotal = meterLines.reduce((sum, line) => sum + line.unitPriceNet, 0);
    const total = chargePeriod.baseAmount + usageCost + meterTotal;

    if (total < MIN_BILLABLE_AMOUNT) {
      if (position.skipIfNoBillableAmount) {
        return null;
      }

      throw new BadRequestException('No billable amount since last invoice');
    }

    return { amount: total, chargePeriod, meterLines };
  }

  private mapMeterLinesToInputs(
    meterLines: MeterChargeLine[] | undefined,
    taxCategory: ReturnType<typeof resolvePlanTaxCategory>,
  ): LineItemInput[] {
    return (meterLines ?? []).map((line) => ({
      description: line.description,
      quantity: line.quantity,
      unitPriceNet: line.unitPriceNet,
      taxCategory,
    }));
  }

  private async getBillableAmountForPosition(position: OpenPositionEntity): Promise<number> {
    const charge = await this.getBillableChargeForPosition(position);

    return charge?.amount ?? 0;
  }

  private extractUsageCost(payload: Record<string, unknown> | undefined): number {
    if (!payload) {
      return 0;
    }

    const direct = this.parseNumeric(payload['totalCost']) ?? this.parseNumeric(payload['usageCost']);

    if (direct !== null) {
      return direct;
    }

    const units = this.parseNumeric(payload['units']);
    const unitPrice = this.parseNumeric(payload['unitPrice']);

    if (units !== null && unitPrice !== null) {
      return units * unitPrice;
    }

    return 0;
  }

  private parseNumeric(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value);

      return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
  }

  private async calculateBaseAmountSinceLastBilling(
    subscription: SubscriptionEntity,
    plan: ServicePlanEntity,
    fullPeriodPrice: number,
    billUntil: Date,
    now: Date = new Date(),
  ): Promise<number> {
    const chargePeriod = await this.subscriptionChargePeriodService.resolveChargePeriod(
      subscription,
      plan,
      fullPeriodPrice,
      billUntil,
      now,
    );

    return chargePeriod?.baseAmount ?? 0;
  }

  private async resolveChargePeriod(
    subscription: SubscriptionEntity,
    plan: ServicePlanEntity,
    fullPeriodPrice: number,
    billUntil: Date,
    now: Date = new Date(),
  ): Promise<ChargePeriodResult | null> {
    return await this.subscriptionChargePeriodService.resolveChargePeriod(
      subscription,
      plan,
      fullPeriodPrice,
      billUntil,
      now,
    );
  }

  private async issueInvoiceWithPromotionCommit(params: {
    subscriptionId: string;
    userId: string;
    lineInputs: LineItemInput[];
    promotionApplications: InvoicePromotionApplicationDraft[];
    redemptionUpdates: PromotionRedemptionUpdate[];
  }): Promise<{ invoiceRefId: string; invoiceNumber?: string }> {
    const rollback = await this.promotionApplicationService.commitRedemptionUpdatesWithRollback(
      params.redemptionUpdates,
    );

    try {
      return await this.invoiceService.createAndIssue({
        subscriptionId: params.subscriptionId,
        userId: params.userId,
        lineInputs: params.lineInputs,
        promotionApplications: params.promotionApplications,
      });
    } catch (error) {
      await this.promotionApplicationService.rollbackRedemptionUpdates(rollback);
      throw error;
    }
  }

  private async resolveSubscriptionPricing(subscriptionId: string, plan: ServicePlanEntity) {
    const items = await this.subscriptionItemsRepository.findBySubscription(subscriptionId);
    const basePriceOverride = await resolveSubscriptionBillingBaseOverride(items, this.providerServerTypesService);

    return this.pricingService.calculate(plan, basePriceOverride);
  }
}
