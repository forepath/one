import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import { getMinCheckoutPaymentAmount } from '../constants/payment-amount.constants';
import type { OpenPositionEntity } from '../entities/open-position.entity';
import { BillingIntervalType } from '../entities/service-plan.entity';
import type { ServicePlanEntity } from '../entities/service-plan.entity';
import type { SubscriptionEntity } from '../entities/subscription.entity';
import { InvoicesRepository } from '../repositories/invoices.repository';
import { OpenPositionsRepository } from '../repositories/open-positions.repository';
import { ServicePlansRepository } from '../repositories/service-plans.repository';
import { SubscriptionsRepository } from '../repositories/subscriptions.repository';
import { SubscriptionItemsRepository } from '../repositories/subscription-items.repository';
import { UsageRecordsRepository } from '../repositories/usage-records.repository';
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
  ) {}

  async createInvoice(subscriptionId: string, userId: string, description?: string, options?: InvoiceCreationOptions) {
    const subscription = await this.subscriptionsRepository.findByIdOrThrow(subscriptionId);

    if (subscription.userId !== userId) {
      throw new BadRequestException('Subscription does not belong to user');
    }

    const plan = await this.servicePlansRepository.findByIdOrThrow(subscription.planId);
    const pricing = await this.resolveSubscriptionPricing(subscriptionId, plan);
    const usage = await this.usageRecordsRepository.findLatestForSubscription(subscriptionId);
    const usageCost = usage ? this.extractUsageCost(usage.usagePayload) : 0;
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

    const total = chargePeriod.baseAmount + usageCost;

    if (total < MIN_BILLABLE_AMOUNT) {
      if (options?.skipIfNoBillableAmount) {
        return undefined;
      }

      throw new BadRequestException('No billable amount since last invoice');
    }

    const roundedTotal = Math.round(total * 100) / 100;
    const taxCategory = resolvePlanTaxCategory(plan);
    const chargeLine = {
      description: description || 'Subscription charge',
      quantity: 1,
      unitPriceNet: roundedTotal,
      taxCategory,
    };
    const promoResult = await this.promotionApplicationService.calculatePromotions({
      userId,
      subscriptionId,
      chargeLines: [chargeLine],
      defaultTaxCategory: taxCategory,
      chargePeriod: { start: chargePeriod.periodStart, end: chargePeriod.periodEnd },
      subscriptionChargeNet: Math.round(chargePeriod.baseAmount * 100) / 100,
    });
    const lineInputs = [...promoResult.discountLines, chargeLine];
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

    const groups = groupOpenPositionsBySubscription(positions);
    const billableGroups: {
      group: (typeof groups)[number];
      chargePeriod: ChargePeriodResult;
      amount: number;
    }[] = [];

    for (const group of groups) {
      if (group.representative.userId !== userId) {
        throw new BadRequestException('Position does not belong to user');
      }

      const charge = await this.getBillableChargeForPosition(group.representative);

      if (charge && charge.amount >= MIN_BILLABLE_AMOUNT) {
        billableGroups.push({ group, chargePeriod: charge.chargePeriod, amount: charge.amount });
      }
    }

    const total = billableGroups.reduce((sum, entry) => sum + entry.amount, 0);

    if (total < MIN_BILLABLE_AMOUNT) {
      return undefined;
    }

    const lineInputs: LineItemInput[] = [];
    const promotionApplications: InvoicePromotionApplicationDraft[] = [];
    const redemptionUpdates: PromotionRedemptionUpdate[] = [];

    for (const { group, amount, chargePeriod } of billableGroups) {
      const subscription = await this.subscriptionsRepository.findByIdOrThrow(group.subscriptionId);
      const plan = await this.servicePlansRepository.findByIdOrThrow(subscription.planId);
      const taxCategory = resolvePlanTaxCategory(plan);
      const chargeLine = {
        description: group.representative.description ?? 'Subscription',
        quantity: 1,
        unitPriceNet: Math.round(amount * 100) / 100,
        taxCategory,
      };
      const promoResult = await this.promotionApplicationService.calculatePromotions({
        userId,
        subscriptionId: group.subscriptionId,
        chargeLines: [chargeLine],
        defaultTaxCategory: taxCategory,
        chargePeriod: { start: chargePeriod.periodStart, end: chargePeriod.periodEnd },
        subscriptionChargeNet: Math.round(chargePeriod.baseAmount * 100) / 100,
      });

      lineInputs.push(...promoResult.discountLines, chargeLine);
      promotionApplications.push(...promoResult.applications);
      redemptionUpdates.push(...promoResult.redemptionUpdates);
    }

    const primarySubscriptionId = billableGroups[0].group.subscriptionId;
    const taxContext = await this.invoiceTaxContextService.resolveForUser(userId);
    const totals = this.taxCalculationService.computeLines(lineInputs, {
      taxTreatment: taxContext.treatment,
      forceChargeNonEuIssuerEuB2b: taxContext.forceChargeNonEuIssuerEuB2b,
    });
    const minCheckoutPaymentAmount = getMinCheckoutPaymentAmount();

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
    const positionIds = billableGroups.flatMap(({ group }) => group.positions.map((position) => position.id));

    await this.openPositionsRepository.markManyBilled(positionIds, result.invoiceRefId);

    return { invoiceRefId: result.invoiceRefId };
  }

  async getUnbilledTotalForUser(userId: string): Promise<number> {
    const positions = await this.openPositionsRepository.findUnbilledByUserId(userId);
    const groups = groupOpenPositionsBySubscription(positions);
    let total = 0;

    for (const group of groups) {
      const netTotal = await this.getBillableNetTotalAfterPromotionsForPosition(group.representative, userId);

      if (netTotal >= MIN_BILLABLE_AMOUNT) {
        total += netTotal;
      }
    }

    return Math.round(total * 100) / 100;
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
  ): Promise<{ amount: number; chargePeriod: ChargePeriodResult } | null> {
    const subscription = await this.subscriptionsRepository.findByIdOrThrow(position.subscriptionId);

    if (subscription.userId !== position.userId) {
      throw new BadRequestException('Subscription does not belong to user');
    }

    const plan = await this.servicePlansRepository.findByIdOrThrow(subscription.planId);
    const pricing = await this.resolveSubscriptionPricing(position.subscriptionId, plan);
    const usage = await this.usageRecordsRepository.findLatestForSubscription(position.subscriptionId);
    const usageCost = usage ? this.extractUsageCost(usage.usagePayload) : 0;
    const chargePeriod = await this.subscriptionChargePeriodService.resolveChargePeriod(
      subscription,
      plan,
      pricing.totalPrice,
      position.billUntil,
    );

    if (!chargePeriod) {
      if (position.skipIfNoBillableAmount) {
        return null;
      }

      throw new BadRequestException('No billable amount since last invoice');
    }

    const total = chargePeriod.baseAmount + usageCost;

    if (total < MIN_BILLABLE_AMOUNT) {
      if (position.skipIfNoBillableAmount) {
        return null;
      }

      throw new BadRequestException('No billable amount since last invoice');
    }

    return { amount: total, chargePeriod };
  }

  private async getBillableAmountForPosition(position: OpenPositionEntity): Promise<number> {
    const charge = await this.getBillableChargeForPosition(position);

    return charge?.amount ?? 0;
  }

  private extractUsageCost(payload: Record<string, unknown>): number {
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
