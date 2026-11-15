import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import { CONFIG_CHANGE_ERROR_CODES, throwConfigChangeBadRequest } from '../constants/config-change-error.constants';
import type { ConfigChangeErrorCode } from '../constants/config-change-error.constants';
import type {
  ConfigChangeAmountsDto,
  ConfigChangeDisclaimerDto,
  ConfigChangeDiscountDto,
  ConfigChangeEligibilityDto,
  ConfigChangePreviewResponseDto,
} from '../dto/config-change-preview-response.dto';
import type { ConfigChangeRequestDto } from '../dto/config-change-request.dto';
import type { ConfigChangeResponseDto } from '../dto/config-change-response.dto';
import { BillingEmailPublisher } from '../email/billing-email.publisher';
import type { AddonEntity } from '../entities/addon.entity';
import type { ServicePlanEntity } from '../entities/service-plan.entity';
import type { SubscriptionAddonEntity } from '../entities/subscription-addon.entity';
import type {
  SubscriptionConfigChangeDisclaimerSnapshot,
  SubscriptionConfigChangeEntity,
  SubscriptionConfigChangeRequestedPayload,
} from '../entities/subscription-config-change.entity';
import type { SubscriptionItemEntity } from '../entities/subscription-item.entity';
import { ProvisioningStatus } from '../entities/subscription-item.entity';
import { SubscriptionEntity, SubscriptionStatus } from '../entities/subscription.entity';
import { BillingNotificationPublisher } from '../notifications/billing-notification.publisher';
import { AddonsRepository } from '../repositories/addons.repository';
import { OpenPositionsRepository } from '../repositories/open-positions.repository';
import { PromotionRedemptionsRepository } from '../repositories/promotion-redemptions.repository';
import { ServicePlansRepository } from '../repositories/service-plans.repository';
import { SubscriptionAddonsRepository } from '../repositories/subscription-addons.repository';
import { SubscriptionConfigChangesRepository } from '../repositories/subscription-config-changes.repository';
import { SubscriptionItemsRepository } from '../repositories/subscription-items.repository';
import { SubscriptionsRepository } from '../repositories/subscriptions.repository';
import { isAddonCompatibleWithProvider } from '../utils/addon-compatibility.utils';
import { convertAddonPriceToPlanPeriod } from '../utils/addon-pricing.util';
import { parsePlanAllowedAddonIds, parsePlanMandatoryAddonIds } from '../utils/plan-addons.utils';
import { roundMoney } from '../utils/promotion-advantage.util';
import { normalizeStoredProviderDefaults } from '../utils/provider-env-defaults.utils';
import { resolveItemProvider } from '../utils/provider-selection.utils';
import { assertServerTypeAllowed, normalizeAllowedServerTypes } from '../utils/provider-server-type.utils';
import {
  resolveServerTypePriceMonthly,
  resolveSubscriptionBillingBaseOverride,
} from '../utils/server-type-billing.utils';

import { AddonService } from './addon.service';
import { PricingService } from './pricing.service';
import { ProviderCatalogDispatchService } from './provider-catalog-dispatch.service';
import { ProviderRegistryService } from './provider-registry.service';
import { ProviderServerTypesService } from './provider-server-types.service';

type ServerTypeDirection = 'none' | 'upgrade' | 'downgrade';

interface ConfigChangeContext {
  subscription: SubscriptionEntity;
  plan: ServicePlanEntity;
  items: SubscriptionItemEntity[];
  activeAddons: SubscriptionAddonEntity[];
  latestChange: SubscriptionConfigChangeEntity | null;
  provider?: string;
  providerDefaults?: Record<string, string>;
  currentServerType?: string;
}

interface ResolvedConfigChange {
  targetServerType?: string;
  serverTypeDirection: ServerTypeDirection;
  newInfraBaseNet?: number;
  addonsToAdd: AddonEntity[];
  addonsToRemove: SubscriptionAddonEntity[];
  addonConfigs?: Record<string, Record<string, string>>;
}

/** Subscription addon states that still count as provisioned (or about to be) for billing. */
const ACTIVE_ADDON_STATUSES: ReadonlySet<string> = new Set(['pending', 'active']);

/**
 * Customer-facing entry point for mid-life subscription configuration changes
 * (server type resize, addon add/remove). It validates and prices the request and
 * records a pending change row; applying it is the job worker's responsibility.
 */
@Injectable()
export class SubscriptionConfigChangeService {
  private readonly logger = new Logger(SubscriptionConfigChangeService.name);

  constructor(
    private readonly subscriptionsRepository: SubscriptionsRepository,
    private readonly servicePlansRepository: ServicePlansRepository,
    private readonly subscriptionItemsRepository: SubscriptionItemsRepository,
    private readonly subscriptionAddonsRepository: SubscriptionAddonsRepository,
    private readonly addonsRepository: AddonsRepository,
    private readonly configChangesRepository: SubscriptionConfigChangesRepository,
    private readonly promotionRedemptionsRepository: PromotionRedemptionsRepository,
    private readonly openPositionsRepository: OpenPositionsRepository,
    private readonly providerRegistry: ProviderRegistryService,
    private readonly providerCatalogDispatchService: ProviderCatalogDispatchService,
    private readonly providerServerTypesService: ProviderServerTypesService,
    private readonly pricingService: PricingService,
    private readonly addonService: AddonService,
    private readonly billingNotificationPublisher: BillingNotificationPublisher,
    private readonly billingEmailPublisher: BillingEmailPublisher,
  ) {}

  async getEligibility(subscriptionId: string, userId: string): Promise<ConfigChangeEligibilityDto> {
    const context = await this.loadContext(subscriptionId, userId);

    return await this.buildEligibility(context);
  }

  async preview(
    subscriptionId: string,
    userId: string,
    dto: ConfigChangeRequestDto,
  ): Promise<ConfigChangePreviewResponseDto> {
    const context = await this.loadContext(subscriptionId, userId);
    const resolved = await this.resolveRequest(context, dto);
    const amounts = await this.computeAmounts(context, resolved);

    return {
      eligibility: await this.buildEligibility(context),
      amounts,
      disclaimer: this.buildDisclaimer(amounts, resolved, context.plan),
      discounts: await this.loadDiscounts(subscriptionId),
    };
  }

  async submit(subscriptionId: string, userId: string, dto: ConfigChangeRequestDto): Promise<ConfigChangeResponseDto> {
    const context = await this.loadContext(subscriptionId, userId);
    const resolved = await this.resolveRequest(context, dto);
    const amounts = await this.computeAmounts(context, resolved);
    const disclaimer = this.buildDisclaimer(amounts, resolved, context.plan);
    const claimed = await this.subscriptionsRepository.compareAndSetStatus(
      subscriptionId,
      SubscriptionStatus.ACTIVE,
      SubscriptionStatus.PENDING_CONFIG_CHANGE,
    );

    if (!claimed) {
      throwConfigChangeBadRequest(
        CONFIG_CHANGE_ERROR_CODES.NOT_ELIGIBLE,
        'Subscription is no longer active; the configuration change was not accepted',
      );
    }

    let change: SubscriptionConfigChangeEntity;

    try {
      change = await this.configChangesRepository.create({
        subscriptionId,
        status: 'pending',
        requestedPayload: this.buildRequestedPayload(resolved),
        billingDisclaimerSnapshot: this.buildDisclaimerSnapshot(amounts, disclaimer),
        appliedSteps: [],
        reclaimCount: 0,
        requestedAt: new Date(),
      });
    } catch (error) {
      await this.releaseSubscriptionClaim(subscriptionId);

      throw error;
    }

    const updated = await this.subscriptionsRepository.findByIdOrThrow(subscriptionId);

    this.billingNotificationPublisher.publishConfigChangeRequested(updated, context.plan, {
      configChangeId: change.id,
    });
    await this.billingEmailPublisher.publishConfigChangeRequested(updated, context.plan.name);

    return this.mapToResponse(change);
  }

  mapToResponse(change: SubscriptionConfigChangeEntity): ConfigChangeResponseDto {
    return {
      id: change.id,
      status: change.status,
      errorCode: change.errorCode ?? null,
      errorMessage: change.errorMessage ?? null,
      appliedSteps: change.appliedSteps ?? [],
      billingOutcome: change.billingOutcome ?? null,
      requestedAt: change.requestedAt,
      processedAt: change.processedAt ?? null,
    };
  }

  private async loadContext(subscriptionId: string, userId: string): Promise<ConfigChangeContext> {
    const subscription = await this.subscriptionsRepository.findByIdOrThrow(subscriptionId);

    if (subscription.userId !== userId) {
      throw new BadRequestException('Subscription does not belong to user');
    }

    const plan = await this.servicePlansRepository.findByIdOrThrow(subscription.planId);
    const items = await this.subscriptionItemsRepository.findBySubscription(subscriptionId);
    const activeAddons = (await this.subscriptionAddonsRepository.findBySubscriptionId(subscriptionId)).filter((row) =>
      ACTIVE_ADDON_STATUSES.has(row.status),
    );
    const latestChange = await this.configChangesRepository.findLatestForSubscription(subscriptionId);
    const itemWithServiceType = items.find((item) => item.serviceType);

    return {
      subscription,
      plan,
      items,
      activeAddons,
      latestChange,
      provider: itemWithServiceType ? (resolveItemProvider(itemWithServiceType) ?? undefined) : undefined,
      providerDefaults: normalizeStoredProviderDefaults(itemWithServiceType?.serviceType?.providerDefaults),
      currentServerType: this.resolveCurrentServerType(items),
    };
  }

  private resolveCurrentServerType(items: SubscriptionItemEntity[]): string | undefined {
    for (const item of items) {
      const value = item.configSnapshot?.['serverType'];

      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }

    return undefined;
  }

  private async buildEligibility(context: ConfigChangeContext): Promise<ConfigChangeEligibilityDto> {
    const detail = context.provider ? this.providerRegistry.getProvider(context.provider) : undefined;
    const hasPendingChange =
      context.latestChange?.status === 'pending' || context.latestChange?.status === 'processing';
    const activeAddonIds = context.activeAddons.map((row) => row.addonId);
    const planAddonIds = parsePlanAllowedAddonIds(context.plan.providerConfigDefaults);
    const planAddons = planAddonIds.length > 0 ? await this.addonsRepository.findByIds(planAddonIds) : [];
    const providerCompatibleAddonIds = new Set(
      planAddons
        .filter((addon) => addon.isActive)
        .filter((addon) => isAddonCompatibleWithProvider(addon, context.provider))
        .map((addon) => addon.id),
    );
    let reasonCode: ConfigChangeErrorCode | undefined;
    let reason: string | undefined;

    if (context.subscription.status !== SubscriptionStatus.ACTIVE) {
      reasonCode = CONFIG_CHANGE_ERROR_CODES.NOT_ELIGIBLE;
      reason = 'Only active subscriptions can be reconfigured';
    } else if (hasPendingChange) {
      reasonCode = CONFIG_CHANGE_ERROR_CODES.NOT_ELIGIBLE;
      reason = 'A configuration change is already in progress';
    } else if (this.hasIncompleteInitialServerProvisioning(context.items)) {
      reasonCode = CONFIG_CHANGE_ERROR_CODES.NOT_ELIGIBLE;
      reason = 'Subscription is still being provisioned';
    }

    return {
      canRequestChange: reasonCode === undefined,
      reasonCode,
      reason,
      hasPendingChange,
      provider: context.provider,
      currentServerType: context.currentServerType,
      allowedServerTypes:
        context.plan.allowCustomerServerTypeSelection === true
          ? normalizeAllowedServerTypes(context.plan.allowedServerTypes)
          : [],
      supportsServerTypeUpgrade: detail?.supportsServerTypeUpgrade === true,
      supportsServerTypeDowngrade: detail?.supportsServerTypeDowngrade === true,
      availableAddonIds: planAddonIds.filter(
        (id) => !activeAddonIds.includes(id) && providerCompatibleAddonIds.has(id),
      ),
      activeAddonIds,
    };
  }

  /** Cloud servers must finish first-time provisioning before mid-life config changes. */
  private hasIncompleteInitialServerProvisioning(items: SubscriptionItemEntity[]): boolean {
    return items.some((item) => {
      const provider = resolveItemProvider(item)?.trim();

      if (!this.providerCatalogDispatchService.requiresProvisioning(provider)) {
        return false;
      }

      return item.provisioningStatus !== ProvisioningStatus.ACTIVE;
    });
  }

  private async resolveRequest(
    context: ConfigChangeContext,
    dto: ConfigChangeRequestDto,
  ): Promise<ResolvedConfigChange> {
    const eligibility = await this.buildEligibility(context);

    if (!eligibility.canRequestChange) {
      throwConfigChangeBadRequest(
        eligibility.reasonCode ?? CONFIG_CHANGE_ERROR_CODES.NOT_ELIGIBLE,
        eligibility.reason ?? 'Subscription cannot be reconfigured',
      );
    }

    const addAddonIds = this.uniqueIds(dto.addAddonIds);
    const removeAddonIds = this.uniqueIds(dto.removeAddonIds);

    this.assertDisjointAddonSelection(addAddonIds, removeAddonIds);
    this.assertAddonConfigsOnlyForAddedAddons(addAddonIds, dto.addonConfigs);

    const serverType = await this.resolveServerTypeChange(context, dto.serverType);
    const addonsToAdd = await this.resolveAddonsToAdd(context, addAddonIds);
    const addonsToRemove = this.resolveAddonsToRemove(context, removeAddonIds);

    if (serverType.direction === 'none' && addonsToAdd.length === 0 && addonsToRemove.length === 0) {
      throwConfigChangeBadRequest(
        CONFIG_CHANGE_ERROR_CODES.NOOP,
        'The requested configuration matches the current configuration',
      );
    }

    return {
      targetServerType: serverType.targetServerType,
      serverTypeDirection: serverType.direction,
      newInfraBaseNet: serverType.newInfraBaseNet,
      addonsToAdd,
      addonsToRemove,
      addonConfigs: dto.addonConfigs,
    };
  }

  private async resolveServerTypeChange(
    context: ConfigChangeContext,
    requested: string | undefined,
  ): Promise<{ targetServerType?: string; direction: ServerTypeDirection; newInfraBaseNet?: number }> {
    const targetServerType = requested?.trim();

    if (!targetServerType || targetServerType === context.currentServerType) {
      return { direction: 'none' };
    }

    const detail = context.provider ? this.providerRegistry.getProvider(context.provider) : undefined;

    if (!detail) {
      throwConfigChangeBadRequest(
        CONFIG_CHANGE_ERROR_CODES.SERVER_TYPE_UNSUPPORTED,
        'This subscription does not run on a provider that supports server type changes',
      );
    }

    if (context.plan.allowCustomerServerTypeSelection !== true) {
      throwConfigChangeBadRequest(
        CONFIG_CHANGE_ERROR_CODES.SERVER_TYPE_UNSUPPORTED,
        'This plan does not allow customer server type selection',
      );
    }

    const allowedError = assertServerTypeAllowed(
      targetServerType,
      normalizeAllowedServerTypes(context.plan.allowedServerTypes),
    );

    if (allowedError) {
      throwConfigChangeBadRequest(CONFIG_CHANGE_ERROR_CODES.SERVER_TYPE_UNSUPPORTED, allowedError);
    }

    const currentPrice = context.currentServerType
      ? await resolveServerTypePriceMonthly(
          this.providerServerTypesService,
          context.provider,
          context.currentServerType,
          context.providerDefaults,
        )
      : null;
    const newPrice = await resolveServerTypePriceMonthly(
      this.providerServerTypesService,
      context.provider,
      targetServerType,
      context.providerDefaults,
    );

    // Fail closed: without both prices the up/down direction (and therefore the
    // provider capability to check) cannot be determined.
    if (currentPrice == null || newPrice == null) {
      throwConfigChangeBadRequest(
        CONFIG_CHANGE_ERROR_CODES.SERVER_TYPE_UNSUPPORTED,
        'Server type pricing is unavailable; the change cannot be evaluated',
      );
    }

    if (newPrice === currentPrice) {
      throwConfigChangeBadRequest(
        CONFIG_CHANGE_ERROR_CODES.SERVER_TYPE_LATERAL_UNSUPPORTED,
        'Lateral server type changes at the same price are not supported',
      );
    }

    const direction: ServerTypeDirection = newPrice > currentPrice ? 'upgrade' : 'downgrade';

    if (direction === 'upgrade' && detail.supportsServerTypeUpgrade !== true) {
      throwConfigChangeBadRequest(
        CONFIG_CHANGE_ERROR_CODES.SERVER_TYPE_UNSUPPORTED,
        'This provider does not support server type upgrades',
      );
    }

    if (direction === 'downgrade' && detail.supportsServerTypeDowngrade !== true) {
      throwConfigChangeBadRequest(
        CONFIG_CHANGE_ERROR_CODES.SERVER_TYPE_UNSUPPORTED,
        'This provider does not support server type downgrades',
      );
    }

    return { targetServerType, direction, newInfraBaseNet: newPrice };
  }

  private async resolveAddonsToAdd(context: ConfigChangeContext, addAddonIds: string[]): Promise<AddonEntity[]> {
    if (addAddonIds.length === 0) {
      return [];
    }

    const provider = context.provider;

    if (!provider || !this.addonService.providerSupportsAddons(provider)) {
      throwConfigChangeBadRequest(CONFIG_CHANGE_ERROR_CODES.ADDON_INVALID, 'This provider does not support addons');
    }

    const planAllowed = new Set(parsePlanAllowedAddonIds(context.plan.providerConfigDefaults));
    const activeAddonIds = new Set(context.activeAddons.map((row) => row.addonId));

    for (const addonId of addAddonIds) {
      if (!planAllowed.has(addonId)) {
        throwConfigChangeBadRequest(
          CONFIG_CHANGE_ERROR_CODES.ADDON_INVALID,
          `Addon ${addonId} is not available on this plan`,
        );
      }

      if (activeAddonIds.has(addonId)) {
        throwConfigChangeBadRequest(
          CONFIG_CHANGE_ERROR_CODES.ADDON_INVALID,
          `Addon ${addonId} is already active on this subscription`,
        );
      }
    }

    const addons = await this.addonsRepository.findByIds(addAddonIds);

    if (addons.length !== addAddonIds.length) {
      throwConfigChangeBadRequest(
        CONFIG_CHANGE_ERROR_CODES.ADDON_INVALID,
        'One or more selected addons were not found',
      );
    }

    for (const addon of addons) {
      if (!addon.isActive) {
        throwConfigChangeBadRequest(CONFIG_CHANGE_ERROR_CODES.ADDON_INVALID, `Addon "${addon.key}" is not active`);
      }

      if (addon.compatibleProviders.length > 0 && !addon.compatibleProviders.includes(provider)) {
        throwConfigChangeBadRequest(
          CONFIG_CHANGE_ERROR_CODES.ADDON_INVALID,
          `Addon "${addon.key}" is not compatible with provider "${provider}"`,
        );
      }
    }

    return addons;
  }

  private resolveAddonsToRemove(context: ConfigChangeContext, removeAddonIds: string[]): SubscriptionAddonEntity[] {
    const mandatoryIds = new Set(parsePlanMandatoryAddonIds(context.plan.providerConfigDefaults));
    const resolved: SubscriptionAddonEntity[] = [];

    for (const addonId of removeAddonIds) {
      if (mandatoryIds.has(addonId)) {
        throwConfigChangeBadRequest(
          CONFIG_CHANGE_ERROR_CODES.ADDON_INVALID,
          `Addon ${addonId} is mandatory on this plan and cannot be removed`,
        );
      }

      const match = context.activeAddons.find((row) => row.addonId === addonId);

      if (!match) {
        throwConfigChangeBadRequest(
          CONFIG_CHANGE_ERROR_CODES.ADDON_INVALID,
          `Addon ${addonId} is not active on this subscription`,
        );
      }

      resolved.push(match);
    }

    return resolved;
  }

  private assertDisjointAddonSelection(addAddonIds: string[], removeAddonIds: string[]): void {
    const removing = new Set(removeAddonIds);

    for (const addonId of addAddonIds) {
      if (removing.has(addonId)) {
        throwConfigChangeBadRequest(
          CONFIG_CHANGE_ERROR_CODES.ADDON_INVALID,
          `Addon ${addonId} cannot be added and removed in the same change`,
        );
      }
    }
  }

  private assertAddonConfigsOnlyForAddedAddons(
    addAddonIds: string[],
    addonConfigs: Record<string, Record<string, string>> | undefined,
  ): void {
    if (!addonConfigs) {
      return;
    }

    const adding = new Set(addAddonIds);

    for (const addonId of Object.keys(addonConfigs)) {
      if (!adding.has(addonId)) {
        throwConfigChangeBadRequest(
          CONFIG_CHANGE_ERROR_CODES.ADDON_CONFIG_IMMUTABLE,
          `Configuration of addon ${addonId} cannot be changed; remove and re-add it instead`,
        );
      }
    }
  }

  private async computeAmounts(
    context: ConfigChangeContext,
    resolved: ResolvedConfigChange,
  ): Promise<ConfigChangeAmountsDto> {
    const currentInfraBaseNet = await resolveSubscriptionBillingBaseOverride(
      context.items,
      this.providerServerTypesService,
    );
    const currentPlanNet = this.pricingService.calculate(context.plan, currentInfraBaseNet).totalPrice;
    const newPlanNet = this.pricingService.calculate(
      context.plan,
      resolved.newInfraBaseNet ?? currentInfraBaseNet,
    ).totalPrice;
    const currentAddonsNet = context.activeAddons.reduce((sum, row) => sum + this.parseSnapshotPrice(row), 0);
    const addedAddonsNet = resolved.addonsToAdd.reduce(
      (sum, addon) => sum + convertAddonPriceToPlanPeriod(addon, context.plan),
      0,
    );
    const removedAddonsNet = resolved.addonsToRemove.reduce((sum, row) => sum + this.parseSnapshotPrice(row), 0);
    const currentPeriodNet = roundMoney(currentPlanNet + currentAddonsNet);
    const newPeriodNet = roundMoney(newPlanNet + currentAddonsNet + addedAddonsNet - removedAddonsNet);
    const periodDeltaNet = roundMoney(newPeriodNet - currentPeriodNet);
    const remainingPeriodRatio = this.resolveRemainingPeriodRatio(context.subscription);
    const elapsedPeriodRatio = Math.min(1, Math.max(0, 1 - remainingPeriodRatio));
    const immediateAdjustmentNet = await this.resolveImmediateAdjustmentNet({
      plan: context.plan,
      subscriptionId: context.subscription.id,
      currentPeriodNet,
      periodDeltaNet,
      remainingPeriodRatio,
      elapsedPeriodRatio,
    });

    return {
      currency: process.env.BILLING_DEFAULT_CURRENCY ?? 'EUR',
      currentPeriodNet,
      newPeriodNet,
      periodDeltaNet,
      immediateAdjustmentNet,
      remainingPeriodRatio,
    };
  }

  /**
   * Mirrors {@link SubscriptionConfigChangeBillingService} settlement math so preview/submit
   * freeze the same one-shot amount the worker will book.
   */
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
        // Pending period invoice will use the new price for the whole period; correct elapsed delta.
        return roundMoney(-periodDeltaNet * elapsedPeriodRatio);
      }

      return roundMoney(periodDeltaNet * remainingPeriodRatio);
    }

    // Arrear: lock elapsed usage at the old period price; remainder bills at the new price after anchor move.
    return roundMoney(currentPeriodNet * elapsedPeriodRatio);
  }

  private buildDisclaimer(
    amounts: ConfigChangeAmountsDto,
    resolved: ResolvedConfigChange,
    plan: ServicePlanEntity,
  ): ConfigChangeDisclaimerDto {
    const notes: string[] = [];

    if (resolved.serverTypeDirection !== 'none') {
      notes.push(
        `Server type ${resolved.serverTypeDirection} to "${resolved.targetServerType}" requires a short reboot.`,
      );
    }

    if (resolved.addonsToAdd.length > 0) {
      notes.push(`${resolved.addonsToAdd.length} addon(s) will be provisioned.`);
    }

    if (resolved.addonsToRemove.length > 0) {
      notes.push(`${resolved.addonsToRemove.length} addon(s) will be removed and stop being billed.`);
    }

    if (plan.billInAdvance === true) {
      if (amounts.immediateAdjustmentNet > 0) {
        notes.push('The prorated difference for the remaining billing period is charged with the next invoice.');
      } else if (amounts.immediateAdjustmentNet < 0) {
        notes.push(
          amounts.periodDeltaNet > 0
            ? 'Your pending period charge will use the new configuration price; a credit covers time already accrued at the old price.'
            : 'The prorated difference for the remaining billing period is credited on the next invoice.',
        );
      } else if (amounts.periodDeltaNet !== 0) {
        notes.push('Your pending period charge will use the new configuration price for the full billing period.');
      }
    } else if (amounts.immediateAdjustmentNet > 0) {
      notes.push(
        'Time already used in this billing period is settled at the current configuration price; the rest of the period bills at the new price.',
      );
    } else if (amounts.periodDeltaNet !== 0) {
      notes.push('From this change onward, the rest of the billing period is billed at the new configuration price.');
    }

    return {
      kind: amounts.immediateAdjustmentNet > 0 ? 'charge' : amounts.immediateAdjustmentNet < 0 ? 'credit' : 'none',
      effectiveAt: new Date(),
      notes,
    };
  }

  private buildDisclaimerSnapshot(
    amounts: ConfigChangeAmountsDto,
    disclaimer: ConfigChangeDisclaimerDto,
  ): SubscriptionConfigChangeDisclaimerSnapshot {
    return {
      currentPeriodNet: amounts.currentPeriodNet,
      newPeriodNet: amounts.newPeriodNet,
      periodDeltaNet: amounts.periodDeltaNet,
      immediateAdjustmentNet: amounts.immediateAdjustmentNet,
      currency: amounts.currency,
      effectiveAt: disclaimer.effectiveAt.toISOString(),
      notes: disclaimer.notes,
    };
  }

  private buildRequestedPayload(resolved: ResolvedConfigChange): SubscriptionConfigChangeRequestedPayload {
    const payload: SubscriptionConfigChangeRequestedPayload = {};

    if (resolved.targetServerType) {
      payload.serverType = resolved.targetServerType;
    }

    if (resolved.addonsToAdd.length > 0) {
      payload.addAddonIds = resolved.addonsToAdd.map((addon) => addon.id);
    }

    if (resolved.addonsToRemove.length > 0) {
      payload.removeAddonIds = resolved.addonsToRemove.map((row) => row.addonId);
    }

    if (resolved.addonConfigs && Object.keys(resolved.addonConfigs).length > 0) {
      payload.addonConfigs = resolved.addonConfigs;
    }

    return payload;
  }

  private async loadDiscounts(subscriptionId: string): Promise<ConfigChangeDiscountDto[]> {
    const redemptions = await this.promotionRedemptionsRepository.findActiveBySubscription(subscriptionId);

    return redemptions.map((redemption) => ({
      redemptionId: redemption.id,
      code: redemption.codeSnapshot,
      advantageType: redemption.promotion?.advantageType ?? 'unknown',
      remainingBillingPeriods: redemption.remainingBillingPeriods ?? null,
      remainingAmountNet: redemption.remainingAmountNet != null ? Number(redemption.remainingAmountNet) : null,
    }));
  }

  private resolveRemainingPeriodRatio(subscription: SubscriptionEntity, now: Date = new Date()): number {
    const start = subscription.currentPeriodStart;
    const end = subscription.currentPeriodEnd;

    if (!start || !end || end.getTime() <= start.getTime()) {
      return 0;
    }

    const ratio = (end.getTime() - now.getTime()) / (end.getTime() - start.getTime());

    return Math.min(1, Math.max(0, ratio));
  }

  private parseSnapshotPrice(row: SubscriptionAddonEntity): number {
    const parsed = Number(row.unitPriceSnapshot ?? 0);

    return Number.isFinite(parsed) ? parsed : 0;
  }

  private uniqueIds(values: string[] | undefined): string[] {
    return [
      ...new Set((values ?? []).map((value) => value?.trim()).filter((value): value is string => Boolean(value))),
    ];
  }

  private async releaseSubscriptionClaim(subscriptionId: string): Promise<void> {
    try {
      await this.subscriptionsRepository.compareAndSetStatus(
        subscriptionId,
        SubscriptionStatus.PENDING_CONFIG_CHANGE,
        SubscriptionStatus.ACTIVE,
      );
    } catch (error) {
      this.logger.error(
        `Failed to release config-change claim on subscription ${subscriptionId}: ${(error as Error).message}`,
      );
    }
  }
}
