import { Injectable, Logger } from '@nestjs/common';

import type { TaxCategory } from '../constants/tax-category.constants';
import { getStatutoryWithdrawalPeriodDays } from '../constants/withdrawal-policy.config';
import type { ServicePlanEntity } from '../entities/service-plan.entity';
import type { SubscriptionAddonEntity } from '../entities/subscription-addon.entity';
import type { SubscriptionEntity } from '../entities/subscription.entity';
import type { PlanCommercialPricingSnapshot } from '../queue/plan-price-migrate.payload';
import { OpenPositionsRepository } from '../repositories/open-positions.repository';
import { ServicePlansRepository } from '../repositories/service-plans.repository';
import { SubscriptionAddonsRepository } from '../repositories/subscription-addons.repository';
import { SubscriptionItemsRepository } from '../repositories/subscription-items.repository';
import { SubscriptionsRepository } from '../repositories/subscriptions.repository';
import {
  PLAN_PRICE_MIGRATE_ADJUSTMENT_KINDS,
  PLAN_PRICE_MIGRATE_CREDIT_REASON,
  planPriceMigrateCarrySourceRef,
  planPriceMigratePrimarySourceRef,
} from '../utils/plan-price-migrate-billing-source-ref.util';
import { resolvePlanTaxCategory } from '../utils/plan-tax.utils';
import {
  PRICE_RECALC_ADJUSTMENT_KINDS,
  PRICE_RECALC_CREDIT_REASON,
  priceRecalcCarrySourceRef,
  priceRecalcPrimarySourceRef,
} from '../utils/price-recalc-billing-source-ref.util';
import { roundMoney } from '../utils/promotion-advantage.util';
import { normalizeStoredProviderDefaults } from '../utils/provider-env-defaults.utils';
import { resolveServiceTypeAllowedProviders } from '../utils/provider-selection.utils';
import {
  BILLING_BASE_PRICE_CONFIG_KEY,
  resolveServerTypePriceMonthly,
  resolveSubscriptionBillingBaseOverride,
} from '../utils/server-type-billing.utils';

import { InvoiceTaxContextService } from './invoice-tax-context.service';
import type { PeriodPriceChangeBillingOutcome } from './period-price-change-billing.types';
import { PricingService } from './pricing.service';
import { ProviderServerTypesService } from './provider-server-types.service';
import { SubscriptionConfigChangeBillingService } from './subscription-config-change-billing.service';
import { TaxCalculationService } from './tax-calculation.service';

const MIN_BILLABLE_AMOUNT = 0.01;

export interface PriceRecalcSubscriptionMigration {
  subscription: SubscriptionEntity;
  planBilling: Pick<ServicePlanEntity, 'billInAdvance' | 'billingIntervalType'>;
  userId: string;
  subscriptionNumber?: string;
  productName: string;
  runDate: string;
  oldNet: number;
  oldTax: number;
  oldTotal: number;
  newNet: number;
  newTax: number;
  newTotal: number;
  billingOutcome: PeriodPriceChangeBillingOutcome;
}

export interface ServicePlanPriceRecalcPlanEvent {
  planId: string;
  planName: string;
  runDate: string;
  oldPeriodPriceNet: number | null;
  newPeriodPriceNet: number | null;
  subscriptionsAffected: number;
}

export interface ServicePlanPriceRecalcResult {
  planId: string;
  planName: string;
  planUpdated: boolean;
  oldPeriodPriceNet: number | null;
  newPeriodPriceNet: number | null;
  migrations: PriceRecalcSubscriptionMigration[];
}

export interface ServicePlanPriceRecalcTenantResult {
  planEvents: ServicePlanPriceRecalcPlanEvent[];
  migrationsByUserId: Record<string, PriceRecalcSubscriptionMigration[]>;
}

@Injectable()
export class ServicePlanPriceRecalcService {
  private readonly logger = new Logger(ServicePlanPriceRecalcService.name);

  constructor(
    private readonly servicePlansRepository: ServicePlansRepository,
    private readonly subscriptionsRepository: SubscriptionsRepository,
    private readonly subscriptionItemsRepository: SubscriptionItemsRepository,
    private readonly subscriptionAddonsRepository: SubscriptionAddonsRepository,
    private readonly openPositionsRepository: OpenPositionsRepository,
    private readonly providerServerTypesService: ProviderServerTypesService,
    private readonly pricingService: PricingService,
    private readonly invoiceTaxContextService: InvoiceTaxContextService,
    private readonly taxCalculationService: TaxCalculationService,
    private readonly billingService: SubscriptionConfigChangeBillingService,
  ) {}

  async processTenant(runDate: string, changedAt: Date): Promise<ServicePlanPriceRecalcTenantResult> {
    const plans = await this.servicePlansRepository.findAutoRecalculatePriceDaily();
    const planEvents: ServicePlanPriceRecalcPlanEvent[] = [];
    const migrationsByUserId: Record<string, PriceRecalcSubscriptionMigration[]> = {};

    for (const plan of plans) {
      try {
        const result = await this.processPlan(plan, runDate, changedAt);

        if (result.planUpdated) {
          planEvents.push({
            planId: result.planId,
            planName: result.planName,
            runDate,
            oldPeriodPriceNet: result.oldPeriodPriceNet,
            newPeriodPriceNet: result.newPeriodPriceNet,
            subscriptionsAffected: result.migrations.length,
          });
        }

        for (const migration of result.migrations) {
          const list = migrationsByUserId[migration.userId] ?? [];

          list.push(migration);
          migrationsByUserId[migration.userId] = list;
        }
      } catch (error) {
        this.logger.error(`Price recalculation failed for service plan ${plan.id}: ${(error as Error).message}`);
      }
    }

    return { planEvents, migrationsByUserId };
  }

  /**
   * Migrates eligible subscriptions after an admin commercial plan change
   * (base price, margins, and/or VAT category), using previous pricing for the "old" side.
   */
  async processCommercialPlanUpdate(params: {
    planId: string;
    changeId: string;
    runDate: string;
    changedAt: Date;
    previousPricing: PlanCommercialPricingSnapshot;
  }): Promise<ServicePlanPriceRecalcResult> {
    const plan = await this.servicePlansRepository.findByIdOrThrow(params.planId);
    const previousPlan = this.clonePlanWithPricing(plan, params.previousPricing);
    const oldPeriodPriceNet = this.pricingService.calculate(previousPlan).totalPrice;
    const newPeriodPriceNet = this.pricingService.calculate(plan).totalPrice;
    const subscriptions = await this.subscriptionsRepository.findEligibleForPriceRecalcByPlanId(plan.id);
    const migrations: PriceRecalcSubscriptionMigration[] = [];

    for (const subscription of subscriptions) {
      try {
        const migration = await this.processCommercialSubscription({
          subscription,
          previousPlan,
          plan,
          runDate: params.runDate,
          changeId: params.changeId,
          changedAt: params.changedAt,
        });

        if (migration) {
          migrations.push(migration);
        }
      } catch (error) {
        this.logger.error(
          `Commercial plan price migration failed for subscription ${subscription.id}: ${(error as Error).message}`,
        );
      }
    }

    return {
      planId: plan.id,
      planName: plan.name,
      planUpdated: true,
      oldPeriodPriceNet,
      newPeriodPriceNet,
      migrations,
    };
  }

  async processPlan(plan: ServicePlanEntity, runDate: string, changedAt: Date): Promise<ServicePlanPriceRecalcResult> {
    const provider = resolveServiceTypeAllowedProviders(plan.serviceType ?? {})[0] ?? undefined;
    const providerDefaults = normalizeStoredProviderDefaults(plan.serviceType?.providerDefaults);
    const defaultServerType = this.resolvePlanPricingServerType(plan);
    const currentPlanBase = this.parseNumeric(plan.basePrice);
    const oldPeriodPriceNet = this.pricingService.calculate(plan, currentPlanBase).totalPrice;

    if (!provider || !defaultServerType) {
      this.logger.warn(`Skipping service plan ${plan.id}; provider or pricing server type is missing`);

      return {
        planId: plan.id,
        planName: plan.name,
        planUpdated: false,
        oldPeriodPriceNet,
        newPeriodPriceNet: oldPeriodPriceNet,
        migrations: [],
      };
    }

    let livePlanBase: number | null;

    try {
      livePlanBase = await resolveServerTypePriceMonthly(
        this.providerServerTypesService,
        provider,
        defaultServerType,
        providerDefaults,
      );
    } catch (error) {
      this.logger.warn(`Skipping service plan ${plan.id}; live catalog lookup failed: ${(error as Error).message}`);

      return {
        planId: plan.id,
        planName: plan.name,
        planUpdated: false,
        oldPeriodPriceNet,
        newPeriodPriceNet: oldPeriodPriceNet,
        migrations: [],
      };
    }

    if (livePlanBase == null) {
      this.logger.warn(`Skipping service plan ${plan.id}; live catalog price is unavailable`);

      return {
        planId: plan.id,
        planName: plan.name,
        planUpdated: false,
        oldPeriodPriceNet,
        newPeriodPriceNet: oldPeriodPriceNet,
        migrations: [],
      };
    }

    const newPeriodPriceNet = this.pricingService.calculate(plan, livePlanBase).totalPrice;
    const planUpdated = !this.sameBasePrice(currentPlanBase, livePlanBase);

    if (planUpdated) {
      await this.servicePlansRepository.update(plan.id, { basePrice: livePlanBase.toFixed(4) });
    }

    const subscriptions = await this.subscriptionsRepository.findEligibleForPriceRecalcByPlanId(plan.id);
    const migrations: PriceRecalcSubscriptionMigration[] = [];

    for (const subscription of subscriptions) {
      try {
        const migration = await this.processSubscription({
          subscription,
          plan,
          runDate,
          changedAt,
          provider,
          providerDefaults,
          livePlanBase,
        });

        if (migration) {
          migrations.push(migration);
        }
      } catch (error) {
        this.logger.error(
          `Price recalculation failed for subscription ${subscription.id}: ${(error as Error).message}`,
        );
      }
    }

    return {
      planId: plan.id,
      planName: plan.name,
      planUpdated,
      oldPeriodPriceNet,
      newPeriodPriceNet,
      migrations,
    };
  }

  private async processSubscription(params: {
    subscription: SubscriptionEntity;
    plan: ServicePlanEntity;
    runDate: string;
    changedAt: Date;
    provider: string;
    providerDefaults: Record<string, string>;
    livePlanBase: number;
  }): Promise<PriceRecalcSubscriptionMigration | null> {
    const { subscription, plan, runDate, changedAt, provider, providerDefaults, livePlanBase } = params;
    const items = await this.subscriptionItemsRepository.findBySubscription(subscription.id);
    const activeAddons = await this.subscriptionAddonsRepository.findActiveBySubscriptionId(subscription.id);
    const currentInfraBase = await resolveSubscriptionBillingBaseOverride(items, this.providerServerTypesService);
    const newInfraBase = await this.resolveNewInfraBase(items, provider, providerDefaults, livePlanBase);
    const addonTotalNet = activeAddons.reduce((sum, addon) => sum + this.parseAddonPrice(addon), 0);
    const currentPeriodNet = roundMoney(
      this.pricingService.calculate(plan, currentInfraBase).totalPrice + addonTotalNet,
    );
    const newPeriodNet = roundMoney(this.pricingService.calculate(plan, newInfraBase).totalPrice + addonTotalNet);
    const periodDeltaNet = roundMoney(newPeriodNet - currentPeriodNet);
    const currentComparableBase = currentInfraBase ?? this.parseNumeric(plan.basePrice);

    if (Math.abs(periodDeltaNet) < MIN_BILLABLE_AMOUNT && this.sameBasePrice(currentComparableBase, newInfraBase)) {
      return null;
    }

    const remainingPeriodRatio = this.resolveRemainingPeriodRatio(subscription, changedAt);
    const elapsedPeriodRatio = Math.min(1, Math.max(0, 1 - remainingPeriodRatio));
    const immediateAdjustmentNet = await this.resolveImmediateAdjustmentNet({
      plan,
      subscriptionId: subscription.id,
      currentPeriodNet,
      periodDeltaNet,
      remainingPeriodRatio,
      elapsedPeriodRatio,
    });
    const billingOutcome = await this.billingService.applySettlement({
      subscription,
      plan,
      changedAt,
      snapshot: {
        currentPeriodNet,
        periodDeltaNet,
        immediateAdjustmentNet,
      },
      primarySourceRef: priceRecalcPrimarySourceRef(runDate, subscription.id),
      carrySourceRef: priceRecalcCarrySourceRef(runDate, subscription.id),
      adjustmentKinds: PRICE_RECALC_ADJUSTMENT_KINDS,
      creditReason: PRICE_RECALC_CREDIT_REASON,
      description: `Daily price recalculation ${runDate} (${subscription.number})`,
      creditLineDescription: `Daily price recalculation ${runDate} credit (${subscription.number})`,
      auditProcess: 'subscription.price_recalc.billing',
      auditIdKey: 'priceRecalcRef',
      auditIdValue: priceRecalcPrimarySourceRef(runDate, subscription.id),
    });

    for (const item of items) {
      await this.subscriptionItemsRepository.updateConfigSnapshot(item.id, {
        ...(item.configSnapshot ?? {}),
        [BILLING_BASE_PRICE_CONFIG_KEY]: newInfraBase,
      });
    }

    await this.subscriptionsRepository.update(subscription.id, {
      statutoryWithdrawalRestartedAt: changedAt,
    });

    const taxContext = await this.invoiceTaxContextService.resolveForUser(subscription.userId);
    const previousTotals = this.computePeriodTotals(currentPeriodNet, plan, taxContext);
    const nextTotals = this.computePeriodTotals(newPeriodNet, plan, taxContext);

    return {
      subscription,
      planBilling: {
        billInAdvance: plan.billInAdvance,
        billingIntervalType: plan.billingIntervalType,
      },
      userId: subscription.userId,
      subscriptionNumber: subscription.number,
      productName: plan.name,
      runDate,
      oldNet: currentPeriodNet,
      oldTax: previousTotals.tax,
      oldTotal: previousTotals.total,
      newNet: newPeriodNet,
      newTax: nextTotals.tax,
      newTotal: nextTotals.total,
      billingOutcome,
    };
  }

  private async processCommercialSubscription(params: {
    subscription: SubscriptionEntity;
    previousPlan: ServicePlanEntity;
    plan: ServicePlanEntity;
    runDate: string;
    changeId: string;
    changedAt: Date;
  }): Promise<PriceRecalcSubscriptionMigration | null> {
    const { subscription, previousPlan, plan, runDate, changeId, changedAt } = params;
    const items = await this.subscriptionItemsRepository.findBySubscription(subscription.id);
    const activeAddons = await this.subscriptionAddonsRepository.findActiveBySubscriptionId(subscription.id);
    const billingBase = await resolveSubscriptionBillingBaseOverride(items, this.providerServerTypesService);
    const addonTotalNet = activeAddons.reduce((sum, addon) => sum + this.parseAddonPrice(addon), 0);
    const currentPeriodNet = roundMoney(
      this.pricingService.calculate(previousPlan, billingBase).totalPrice + addonTotalNet,
    );
    const newPeriodNet = roundMoney(this.pricingService.calculate(plan, billingBase).totalPrice + addonTotalNet);
    const periodDeltaNet = roundMoney(newPeriodNet - currentPeriodNet);
    const previousTaxCategory = resolvePlanTaxCategory(previousPlan);
    const nextTaxCategory = resolvePlanTaxCategory(plan);
    const taxCategoryChanged = previousTaxCategory !== nextTaxCategory;

    if (Math.abs(periodDeltaNet) < MIN_BILLABLE_AMOUNT && !taxCategoryChanged) {
      return null;
    }

    let billingOutcome: PeriodPriceChangeBillingOutcome = 'none';

    if (Math.abs(periodDeltaNet) >= MIN_BILLABLE_AMOUNT) {
      const remainingPeriodRatio = this.resolveRemainingPeriodRatio(subscription, changedAt);
      const elapsedPeriodRatio = Math.min(1, Math.max(0, 1 - remainingPeriodRatio));
      const immediateAdjustmentNet = await this.resolveImmediateAdjustmentNet({
        plan,
        subscriptionId: subscription.id,
        currentPeriodNet,
        periodDeltaNet,
        remainingPeriodRatio,
        elapsedPeriodRatio,
      });

      billingOutcome = await this.billingService.applySettlement({
        subscription,
        plan,
        changedAt,
        snapshot: {
          currentPeriodNet,
          periodDeltaNet,
          immediateAdjustmentNet,
        },
        primarySourceRef: planPriceMigratePrimarySourceRef(changeId, subscription.id),
        carrySourceRef: planPriceMigrateCarrySourceRef(changeId, subscription.id),
        adjustmentKinds: PLAN_PRICE_MIGRATE_ADJUSTMENT_KINDS,
        creditReason: PLAN_PRICE_MIGRATE_CREDIT_REASON,
        description: `Service plan price update ${runDate} (${subscription.number})`,
        creditLineDescription: `Service plan price update ${runDate} credit (${subscription.number})`,
        auditProcess: 'subscription.plan_price_migrate.billing',
        auditIdKey: 'planPriceMigrateRef',
        auditIdValue: planPriceMigratePrimarySourceRef(changeId, subscription.id),
      });
    }

    await this.subscriptionsRepository.update(subscription.id, {
      statutoryWithdrawalRestartedAt: changedAt,
    });

    const taxContext = await this.invoiceTaxContextService.resolveForUser(subscription.userId);
    const previousTotals = this.computePeriodTotals(currentPeriodNet, previousPlan, taxContext);
    const nextTotals = this.computePeriodTotals(newPeriodNet, plan, taxContext);

    return {
      subscription,
      planBilling: {
        billInAdvance: plan.billInAdvance,
        billingIntervalType: plan.billingIntervalType,
      },
      userId: subscription.userId,
      subscriptionNumber: subscription.number,
      productName: plan.name,
      runDate,
      oldNet: currentPeriodNet,
      oldTax: previousTotals.tax,
      oldTotal: previousTotals.total,
      newNet: newPeriodNet,
      newTax: nextTotals.tax,
      newTotal: nextTotals.total,
      billingOutcome,
    };
  }

  private clonePlanWithPricing(plan: ServicePlanEntity, pricing: PlanCommercialPricingSnapshot): ServicePlanEntity {
    return {
      ...plan,
      basePrice: pricing.basePrice ?? undefined,
      marginPercent: pricing.marginPercent ?? undefined,
      marginFixed: pricing.marginFixed ?? undefined,
      taxCategory: pricing.taxCategory as TaxCategory,
    } as ServicePlanEntity;
  }

  private resolvePlanPricingServerType(plan: ServicePlanEntity): string | undefined {
    const configuredServerType = plan.providerConfigDefaults?.['serverType'];

    if (typeof configuredServerType === 'string' && configuredServerType.trim()) {
      return configuredServerType.trim();
    }

    return plan.allowedServerTypes.find((value) => typeof value === 'string' && value.trim())?.trim();
  }

  private async resolveNewInfraBase(
    items: Array<{ configSnapshot?: Record<string, unknown> }>,
    provider: string,
    providerDefaults: Record<string, string>,
    livePlanBase: number,
  ): Promise<number> {
    for (const item of items) {
      const serverType = item.configSnapshot?.['serverType'];

      if (typeof serverType !== 'string' || !serverType.trim()) {
        continue;
      }

      try {
        const resolved = await resolveServerTypePriceMonthly(
          this.providerServerTypesService,
          provider,
          serverType.trim(),
          providerDefaults,
        );

        if (resolved != null) {
          return resolved;
        }
      } catch (error) {
        this.logger.warn(`Falling back to plan base for server type ${serverType}: ${(error as Error).message}`);
      }
    }

    return livePlanBase;
  }

  private async resolveImmediateAdjustmentNet(params: {
    plan: ServicePlanEntity;
    subscriptionId: string;
    currentPeriodNet: number;
    periodDeltaNet: number;
    remainingPeriodRatio: number;
    elapsedPeriodRatio: number;
  }): Promise<number> {
    const { plan, currentPeriodNet, periodDeltaNet, remainingPeriodRatio, elapsedPeriodRatio } = params;

    if (plan.billInAdvance === true) {
      const hasUnbilledPeriodCharge = await this.openPositionsRepository.hasUnbilledPeriodChargeForSubscription(
        params.subscriptionId,
      );

      if (hasUnbilledPeriodCharge) {
        return roundMoney(-periodDeltaNet * elapsedPeriodRatio);
      }

      return roundMoney(periodDeltaNet * remainingPeriodRatio);
    }

    return roundMoney(currentPeriodNet * elapsedPeriodRatio);
  }

  private resolveRemainingPeriodRatio(subscription: SubscriptionEntity, now: Date): number {
    const start = subscription.currentPeriodStart;
    const end = subscription.currentPeriodEnd;

    if (!start || !end || end.getTime() <= start.getTime()) {
      return 0;
    }

    const ratio = (end.getTime() - now.getTime()) / (end.getTime() - start.getTime());

    return Math.min(1, Math.max(0, ratio));
  }

  private computePeriodTotals(
    net: number,
    plan: ServicePlanEntity,
    taxContext: Awaited<ReturnType<InvoiceTaxContextService['resolveForUser']>>,
  ): { tax: number; total: number } {
    const totalGross = this.taxCalculationService.computeLines(
      [
        {
          description: 'Subscription period',
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

    return {
      tax: roundMoney(totalGross - net),
      total: roundMoney(totalGross),
    };
  }

  private parseAddonPrice(addon: SubscriptionAddonEntity): number {
    const parsed = Number(addon.unitPriceSnapshot ?? 0);

    return Number.isFinite(parsed) ? parsed : 0;
  }

  private parseNumeric(value?: string | null): number | undefined {
    if (!value?.trim()) {
      return undefined;
    }

    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private sameBasePrice(left: number | undefined, right: number | undefined): boolean {
    if (left == null && right == null) {
      return true;
    }

    if (left == null || right == null) {
      return false;
    }

    return Math.abs(left - right) < 0.00005;
  }

  getWithdrawalPeriodDays(): number {
    return getStatutoryWithdrawalPeriodDays();
  }
}
