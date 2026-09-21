import { BadRequestException, Injectable } from '@nestjs/common';

import type { CreateSubscriptionDto } from '../../dto/create-subscription.dto';
import type { AddonEntity } from '../../entities/addon.entity';
import { BillingIntervalType, type ServicePlanEntity } from '../../entities/service-plan.entity';
import { ServicePlansRepository } from '../../repositories/service-plans.repository';
import { ServiceTypesRepository } from '../../repositories/service-types.repository';
import { AddonService } from '../../services/addon.service';
import { AvailabilityService } from '../../services/availability.service';
import { CloudInitConfigService } from '../../services/cloud-init-config.service';
import { CustomerProfilesService } from '../../services/customer-profiles.service';
import { InvoiceTaxContextService } from '../../services/invoice-tax-context.service';
import { PricingService } from '../../services/pricing.service';
import { ProviderCatalogDispatchService } from '../../services/provider-catalog-dispatch.service';
import { ProviderRegistryService } from '../../services/provider-registry.service';
import { ProviderServerTypesService } from '../../services/provider-server-types.service';
import { TaxCalculationService } from '../../services/tax-calculation.service';
import { assertAddonConfigsMatchSelection } from '../../utils/addon-config.utils';
import { convertAddonPriceToPlanPeriod } from '../../utils/addon-pricing.util';
import { normalizeCloudInitService } from '../../utils/cloud-init/cloud-init-dispatch.utils';
import { CloudInitServiceType } from '../../utils/cloud-init/integrated-provisioning-service';
import {
  applyResolvedProvisioningSelectionToConfig,
  resolveOrderProvisioningSelection,
} from '../../utils/cloud-init/plan-provisioning-options.utils';
import { validateConfigSchema } from '../../utils/config-validation.utils';
import { mergeOrderAddonIds, parsePlanAllowedAddonIds } from '../../utils/plan-addons.utils';
import { resolvePlanTaxCategory } from '../../utils/plan-tax.utils';
import {
  mirrorGeographyInConfig,
  readRequestedGeography,
  resolveDefaultGeographyForProvider,
  resolveProvisioningRegion,
  stripGeographyByProviderFromConfig,
  stripGeographyFromRequestedConfig,
} from '../../utils/provider-location.utils';
import {
  assertServerTypeAllowed,
  normalizeAllowedServerTypes,
  resolveDefaultServerTypeForProvider,
  stripServerTypeByProviderFromConfig,
  stripServerTypeFromRequestedConfig,
} from '../../utils/provider-server-type.utils';
import {
  assertProviderAllowed,
  resolveEffectiveProvider,
  resolvePlanAllowedProviders,
  resolveServiceTypeAllowedProviders,
  stripProviderFromRequestedConfig,
} from '../../utils/provider-selection.utils';
import { enrichPricingWithTax } from '../../utils/pricing-tax.utils';
import {
  BILLING_BASE_PRICE_CONFIG_KEY,
  resolvePeriodTotalPrice,
  resolveServerTypePriceMonthly,
} from '../../utils/server-type-billing.utils';
import { normalizeStoredProviderDefaults } from '../../utils/provider-env-defaults.utils';

export interface PreparedPlanOrderResult {
  effectiveConfig: Record<string, unknown>;
  addonIds: string[];
  addonConfigs?: Record<string, Record<string, string>>;
  pricingSnapshot: Record<string, unknown>;
  planName: string;
  unitLabel: string;
  availabilityCheckedAt: Date | null;
  periodTotalPrice: number;
  description: string;
}

export interface PreparedPlanOrderAvailability {
  isAvailable: boolean;
  reason?: string;
  alternatives?: Record<string, unknown>;
}

export type PreparedPlanOrderContext = PreparedPlanOrderResult & {
  plan: ServicePlanEntity;
  selectedAddons: AddonEntity[];
  sanitizedRequested: Record<string, unknown>;
  periodUnitPriceNet: number;
  availability: PreparedPlanOrderAvailability | null;
  billingOnly: boolean;
};

export interface PrepareForUserOptions {
  /** When true (default), throws on availability failure instead of returning availability metadata. */
  throwOnUnavailable?: boolean;
  /** Optional line description override (offer plan_template lines). */
  lineDescription?: string;
}

@Injectable()
export class SubscriptionOrderPreparationService {
  constructor(
    private readonly customerProfilesService: CustomerProfilesService,
    private readonly servicePlansRepository: ServicePlansRepository,
    private readonly serviceTypesRepository: ServiceTypesRepository,
    private readonly addonService: AddonService,
    private readonly availabilityService: AvailabilityService,
    private readonly cloudInitConfigService: CloudInitConfigService,
    private readonly providerServerTypesService: ProviderServerTypesService,
    private readonly pricingService: PricingService,
    private readonly taxCalculationService: TaxCalculationService,
    private readonly invoiceTaxContextService: InvoiceTaxContextService,
    private readonly providerCatalogDispatchService: ProviderCatalogDispatchService,
    private readonly providerRegistry: ProviderRegistryService,
  ) {}

  async prepareForUser(
    userId: string,
    dto: CreateSubscriptionDto,
    options?: PrepareForUserOptions,
  ): Promise<PreparedPlanOrderContext> {
    const throwOnUnavailable = options?.throwOnUnavailable !== false;
    const profile = await this.customerProfilesService.getByUserId(userId);

    if (!this.customerProfilesService.isProfileComplete(profile)) {
      throw new BadRequestException(
        'Customer billing profile must be complete before ordering. Please complete your profile.',
      );
    }

    const plan = await this.servicePlansRepository.findByIdOrThrow(dto.planId);

    if (!plan.serviceTypeId) {
      return this.prepareBillingOnlyPlan(userId, plan, dto, options?.lineDescription);
    }

    return this.prepareServiceTypePlan(userId, plan, dto, throwOnUnavailable, options?.lineDescription);
  }

  private async prepareBillingOnlyPlan(
    userId: string,
    plan: ServicePlanEntity,
    dto: CreateSubscriptionDto,
    lineDescription?: string,
  ): Promise<PreparedPlanOrderContext> {
    const selectedAddonIds = [...new Set((dto.addonIds ?? []).filter(Boolean))];

    if (selectedAddonIds.length > 0) {
      throw new BadRequestException('Addons are not supported for plans without a service type');
    }

    if (dto.autoBackorder) {
      throw new BadRequestException('Backorders are not supported for plans without a service type');
    }

    const taxContext = await this.invoiceTaxContextService.resolveForUser(userId);
    const taxCategory = resolvePlanTaxCategory(plan);
    const planPricing = this.pricingService.calculate(plan);
    const taxed = enrichPricingWithTax(planPricing, taxCategory, this.taxCalculationService, {
      taxTreatment: taxContext.treatment,
      forceChargeNonEuIssuerEuB2b: taxContext.forceChargeNonEuIssuerEuB2b,
    });
    const periodTotalPrice = await resolvePeriodTotalPrice(
      plan,
      this.pricingService,
      this.taxCalculationService,
      this.providerServerTypesService,
      {
        computeOptions: {
          taxTreatment: taxContext.treatment,
          forceChargeNonEuIssuerEuB2b: taxContext.forceChargeNonEuIssuerEuB2b,
        },
      },
    );

    return {
      effectiveConfig: {},
      addonIds: [],
      addonConfigs: undefined,
      pricingSnapshot: {
        basePrice: planPricing.basePrice,
        marginPercent: planPricing.marginPercent,
        marginFixed: planPricing.marginFixed,
        totalPrice: planPricing.totalPrice,
        addonLines: [],
        addonsTotal: 0,
        grandTotal: planPricing.totalPrice,
        taxTotal: taxed.taxTotal,
        totalGross: taxed.totalGross,
        taxRate: taxed.taxRate,
        taxCategory,
      },
      planName: plan.name,
      unitLabel: resolvePlanUnitLabel(plan),
      availabilityCheckedAt: null,
      periodTotalPrice,
      description: lineDescription?.trim() || plan.name,
      plan,
      selectedAddons: [],
      sanitizedRequested: {},
      periodUnitPriceNet: planPricing.totalPrice,
      availability: null,
      billingOnly: true,
    };
  }

  private async prepareServiceTypePlan(
    userId: string,
    plan: ServicePlanEntity,
    dto: CreateSubscriptionDto,
    throwOnUnavailable: boolean,
    lineDescription?: string,
  ): Promise<PreparedPlanOrderContext> {
    const serviceType = await this.serviceTypesRepository.findByIdOrThrow(plan.serviceTypeId!);
    const selectedAddonIds = mergeOrderAddonIds(dto.addonIds, plan.providerConfigDefaults);
    const { compatible: selectedAddons } = await this.addonService.resolveOrderAddonSelection(
      plan.serviceTypeId!,
      parsePlanAllowedAddonIds(plan.providerConfigDefaults),
      selectedAddonIds,
      dto.requestedConfig,
      plan,
    );
    const compatibleAddonIds = new Set(selectedAddons.map((addon) => addon.id));
    const filteredAddonConfigs =
      dto.addonConfigs == null
        ? undefined
        : Object.fromEntries(Object.entries(dto.addonConfigs).filter(([addonId]) => compatibleAddonIds.has(addonId)));

    assertAddonConfigsMatchSelection([...compatibleAddonIds], filteredAddonConfigs);

    const allowCustomerLocationSelection = plan.allowCustomerLocationSelection === true;
    const allowCustomerServerTypeSelection = plan.allowCustomerServerTypeSelection === true;
    const allowCustomerProviderSelection = plan.allowCustomerProviderSelection === true;
    let sanitizedRequested = allowCustomerLocationSelection
      ? { ...(dto.requestedConfig ?? {}) }
      : stripGeographyFromRequestedConfig(dto.requestedConfig);
    sanitizedRequested = allowCustomerServerTypeSelection
      ? sanitizedRequested
      : stripServerTypeFromRequestedConfig(sanitizedRequested);
    sanitizedRequested = allowCustomerProviderSelection
      ? sanitizedRequested
      : stripProviderFromRequestedConfig(sanitizedRequested);
    const baseConfig = plan.providerConfigDefaults ?? {};
    const effectiveConfig: Record<string, unknown> = {
      ...(baseConfig || {}),
      ...sanitizedRequested,
    };

    stripServerTypeByProviderFromConfig(effectiveConfig);
    stripGeographyByProviderFromConfig(effectiveConfig);

    try {
      const selection = resolveOrderProvisioningSelection(baseConfig, sanitizedRequested);

      applyResolvedProvisioningSelectionToConfig(effectiveConfig, selection);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }

    if (allowCustomerProviderSelection) {
      const requestedProvider =
        typeof sanitizedRequested['provider'] === 'string' ? sanitizedRequested['provider'].trim() : '';

      if (requestedProvider) {
        const allowedError = assertProviderAllowed(requestedProvider, resolvePlanAllowedProviders(plan, serviceType));

        if (allowedError) {
          throw new BadRequestException(allowedError);
        }
      }
    }

    const provider = resolveEffectiveProvider(serviceType, plan, sanitizedRequested);
    const primaryForProvisioningCheck = resolveServiceTypeAllowedProviders(serviceType)[0] ?? undefined;

    if (!provider && this.providerCatalogDispatchService.requiresProvisioning(primaryForProvisioningCheck)) {
      throw new BadRequestException('provider could not be resolved for this service type');
    }

    if (provider) {
      effectiveConfig.provider = provider;
    }

    if (this.providerCatalogDispatchService.requiresProvisioning(provider ?? undefined)) {
      const planDefaultGeo = resolveDefaultGeographyForProvider(baseConfig, provider);
      const requestedGeo = readRequestedGeography(sanitizedRequested);
      const geography = allowCustomerLocationSelection
        ? requestedGeo || planDefaultGeo || resolveProvisioningRegion({}, provider!)
        : planDefaultGeo || resolveProvisioningRegion({}, provider!);

      mirrorGeographyInConfig(effectiveConfig, geography);
    }

    const schemaForValidation =
      (provider ? this.providerRegistry.getProvider(provider)?.configSchema : undefined) ?? serviceType.configSchema;
    const validationErrors = validateConfigSchema(schemaForValidation, effectiveConfig);

    if (validationErrors.length > 0) {
      throw new BadRequestException(validationErrors.join('; '));
    }

    if (this.providerCatalogDispatchService.requiresProvisioning(provider ?? undefined)) {
      const planDefaultServerType = resolveDefaultServerTypeForProvider(baseConfig, provider);
      const requestedServerType =
        typeof sanitizedRequested['serverType'] === 'string' ? sanitizedRequested['serverType'].trim() : '';

      if (allowCustomerServerTypeSelection) {
        const allowed = normalizeAllowedServerTypes(plan.allowedServerTypes);
        const resolvedServerType = String(
          requestedServerType || planDefaultServerType || (provider === 'digital-ocean' ? 's-1vcpu-1gb' : 'cx11'),
        );
        const serverTypeError = assertServerTypeAllowed(resolvedServerType, allowed);

        if (serverTypeError) {
          throw new BadRequestException(serverTypeError);
        }

        effectiveConfig.serverType = resolvedServerType.trim();
      } else {
        effectiveConfig.serverType = planDefaultServerType ?? (provider === 'digital-ocean' ? 's-1vcpu-1gb' : 'cx11');
      }
    }

    const service = normalizeCloudInitService(effectiveConfig.service as string | undefined);

    if (
      service === CloudInitServiceType.AgenstraManager &&
      (effectiveConfig.authenticationMethod as string) === 'users'
    ) {
      effectiveConfig.authenticationMethod = 'api-key';
    }

    if (service === 'custom') {
      const cloudInitConfigId = effectiveConfig.cloudInitConfigId as string | undefined;

      if (!cloudInitConfigId?.trim()) {
        throw new BadRequestException('cloudInitConfigId is required when service is custom');
      }

      const customTemplate = await this.cloudInitConfigService.findByIdForProvisioning(cloudInitConfigId.trim());
      const requestedEnv = (sanitizedRequested?.['env'] ?? effectiveConfig['env']) as
        | Record<string, unknown>
        | undefined;
      const resolvedCustomEnv = this.cloudInitConfigService.resolveEnvironmentVariables(customTemplate, requestedEnv);

      effectiveConfig.env = resolvedCustomEnv;
    }

    const providerDefaults = normalizeStoredProviderDefaults(serviceType.providerDefaults);
    let availabilityCheckedAt: Date | null = null;
    let availability: PreparedPlanOrderAvailability | null = null;

    if (provider && this.providerCatalogDispatchService.requiresProvisioning(provider)) {
      const region = resolveProvisioningRegion(effectiveConfig, provider);
      const serverType =
        (effectiveConfig.serverType as string | undefined) ?? (provider === 'digital-ocean' ? 's-1vcpu-1gb' : 'cx11');

      if (allowCustomerServerTypeSelection) {
        const billingBasePrice = await resolveServerTypePriceMonthly(
          this.providerServerTypesService,
          provider,
          serverType,
          providerDefaults,
        );

        if (billingBasePrice != null) {
          effectiveConfig[BILLING_BASE_PRICE_CONFIG_KEY] = billingBasePrice;
        }
      }

      const availabilityResult = await this.availabilityService.checkAvailability(
        provider,
        region,
        serverType,
        providerDefaults,
      );
      availabilityCheckedAt = new Date();
      availability = {
        isAvailable: availabilityResult.isAvailable,
        reason: availabilityResult.reason,
        alternatives: availabilityResult.alternatives ?? {},
      };

      if (!availabilityResult.isAvailable) {
        if (throwOnUnavailable) {
          throw new BadRequestException(availabilityResult.reason || 'Configuration not available');
        }
      }
    }

    const taxContext = await this.invoiceTaxContextService.resolveForUser(userId);
    const taxCategory = resolvePlanTaxCategory(plan);
    const computeOptions = {
      taxTreatment: taxContext.treatment,
      forceChargeNonEuIssuerEuB2b: taxContext.forceChargeNonEuIssuerEuB2b,
    };
    const allowCustomerServerTypeSelectionForPricing = plan.allowCustomerServerTypeSelection === true;
    let serverTypeId = '';

    if (allowCustomerServerTypeSelectionForPricing) {
      const requestedServerType = effectiveConfig['serverType'];
      serverTypeId =
        typeof requestedServerType === 'string' && requestedServerType.trim() ? requestedServerType.trim() : '';
    }

    let planPricing = this.pricingService.calculate(plan);

    if (serverTypeId && plan.serviceTypeId) {
      const priceMonthly = await resolveServerTypePriceMonthly(
        this.providerServerTypesService,
        provider,
        serverTypeId,
        providerDefaults,
      );

      if (priceMonthly != null) {
        planPricing = this.pricingService.calculate(plan, priceMonthly);
      }
    }

    const addonLines = selectedAddons.map((addon) => ({
      addonId: addon.id,
      name: addon.name,
      periodPrice: convertAddonPriceToPlanPeriod(addon, plan),
    }));
    const addonsTotal =
      Math.round(selectedAddons.reduce((sum, addon) => sum + convertAddonPriceToPlanPeriod(addon, plan), 0) * 100) /
      100;
    const grandTotal = Math.round((planPricing.totalPrice + addonsTotal) * 100) / 100;
    const taxed = enrichPricingWithTax(
      { ...planPricing, totalPrice: grandTotal },
      taxCategory,
      this.taxCalculationService,
      computeOptions,
    );
    const periodTotalPrice = await resolvePeriodTotalPrice(
      plan,
      this.pricingService,
      this.taxCalculationService,
      this.providerServerTypesService,
      {
        configSnapshot: effectiveConfig,
        serviceType,
        computeOptions,
      },
    );

    return {
      effectiveConfig,
      addonIds: selectedAddons.map((addon) => addon.id),
      addonConfigs: filteredAddonConfigs,
      pricingSnapshot: {
        basePrice: planPricing.basePrice,
        marginPercent: planPricing.marginPercent,
        marginFixed: planPricing.marginFixed,
        totalPrice: planPricing.totalPrice,
        addonLines,
        addonsTotal,
        grandTotal,
        taxTotal: taxed.taxTotal,
        totalGross: taxed.totalGross,
        taxRate: taxed.taxRate,
        taxCategory,
      },
      planName: plan.name,
      unitLabel: resolvePlanUnitLabel(plan),
      availabilityCheckedAt,
      periodTotalPrice,
      description: lineDescription?.trim() || plan.name,
      plan,
      selectedAddons,
      sanitizedRequested,
      periodUnitPriceNet: grandTotal,
      availability,
      billingOnly: false,
    };
  }
}

export function resolvePlanUnitLabel(
  plan: Pick<ServicePlanEntity, 'billingIntervalType' | 'billingIntervalValue'>,
): string {
  const value = plan.billingIntervalValue;
  const type = plan.billingIntervalType;

  if (value === 1) {
    return type;
  }

  const plural =
    type === BillingIntervalType.MONTH
      ? 'months'
      : type === BillingIntervalType.YEAR
        ? 'years'
        : type === BillingIntervalType.DAY
          ? 'days'
          : 'hours';

  return `${value} ${plural}`;
}
