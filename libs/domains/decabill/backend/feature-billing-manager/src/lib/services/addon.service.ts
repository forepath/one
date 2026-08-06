import { BadRequestException, Injectable } from '@nestjs/common';

import { CloudInitConfigOrderFieldDto } from '../dto/cloud-init-config-response.dto';
import { CreateAddonDto } from '../dto/create-addon.dto';
import { UpdateAddonDto } from '../dto/update-addon.dto';
import { AddonEntity, AddonImplementationType } from '../entities/addon.entity';
import { BillingIntervalType } from '../entities/service-plan.entity';
import { AddonsRepository } from '../repositories/addons.repository';
import { ServicePlansRepository } from '../repositories/service-plans.repository';
import { ServiceTypesRepository } from '../repositories/service-types.repository';
import { SubscriptionAddonsRepository } from '../repositories/subscription-addons.repository';
import {
  getAddonOrderFields,
  mergeAddonDefaultValues,
  parseAddonConfigFields,
  sanitizeAddonConfigFields,
  type SanitizedAddonConfigResult,
} from '../utils/addon-config.utils';
import { assertNonNegativeAddonPrice } from '../utils/addon-pricing.util';
import { planReferencesAddonId } from '../utils/plan-addons.utils';
import { AddonModuleRegistryService } from './addon-module-registry.service';
import { ProviderRegistryService } from './provider-registry.service';

const SERVICE_PLAN_REFERENCE_BATCH_SIZE = 100;

@Injectable()
export class AddonService {
  constructor(
    private readonly addonsRepository: AddonsRepository,
    private readonly servicePlansRepository: ServicePlansRepository,
    private readonly serviceTypesRepository: ServiceTypesRepository,
    private readonly providerRegistry: ProviderRegistryService,
    private readonly addonModuleRegistry: AddonModuleRegistryService,
    private readonly subscriptionAddonsRepository: SubscriptionAddonsRepository,
  ) {}

  validateCreatePayload(dto: CreateAddonDto): void {
    this.validateImplementationPayload(dto.implementationType, dto.moduleKey, dto.scriptTemplate);
    this.validatePricing(dto.basePrice, dto.priceIntervalType, dto.priceIntervalValue);
    this.validateCompatibleProviders(dto.compatibleProviders);
  }

  listRegisteredModules(): Array<{
    key: string;
    displayName: string;
    meters: Array<{
      key: string;
      name: string;
      description?: string;
      unitLabel?: string;
      aggregator: string;
      defaultUnitPriceNet: number;
    }>;
  }> {
    return this.addonModuleRegistry.list().map((module) => ({
      key: module.key,
      displayName: module.displayName,
      meters: (module.meters ?? []).map((meter) => ({
        key: meter.key,
        name: meter.name,
        description: meter.description,
        unitLabel: meter.unitLabel,
        aggregator: meter.aggregator,
        defaultUnitPriceNet: meter.defaultUnitPriceNet,
      })),
    }));
  }

  validateUpdatePayload(
    existing: AddonEntity,
    dto: UpdateAddonDto,
  ): {
    implementationType: AddonImplementationType;
    moduleKey?: string | null;
    scriptTemplate?: string | null;
  } {
    const implementationType = dto.implementationType ?? existing.implementationType;
    const moduleKey = dto.moduleKey !== undefined ? dto.moduleKey : existing.moduleKey;
    const scriptTemplate = dto.scriptTemplate !== undefined ? dto.scriptTemplate : existing.scriptTemplate;

    this.validateImplementationPayload(implementationType, moduleKey ?? undefined, scriptTemplate ?? undefined);

    if (dto.basePrice !== undefined || dto.priceIntervalType !== undefined || dto.priceIntervalValue !== undefined) {
      const basePrice = dto.basePrice !== undefined ? dto.basePrice : existing.basePrice;
      const priceIntervalType =
        dto.priceIntervalType !== undefined ? dto.priceIntervalType : existing.priceIntervalType;
      const priceIntervalValue =
        dto.priceIntervalValue !== undefined ? dto.priceIntervalValue : existing.priceIntervalValue;

      this.validatePricing(basePrice ?? undefined, priceIntervalType ?? undefined, priceIntervalValue ?? undefined);
    }

    if (dto.compatibleProviders !== undefined) {
      this.validateCompatibleProviders(dto.compatibleProviders);
    }

    return { implementationType, moduleKey, scriptTemplate };
  }

  /**
   * Normalize configSchema + encrypted defaults for create/update.
   * Module addons take field definitions from the registered module; script addons from admin input.
   */
  resolveConfigForWrite(params: {
    implementationType: AddonImplementationType;
    moduleKey?: string | null;
    configSchema?: Record<string, unknown>;
    defaultValues?: Record<string, string>;
    existing?: AddonEntity;
  }): SanitizedAddonConfigResult {
    const { implementationType, moduleKey, configSchema, defaultValues, existing } = params;
    let fieldDefs = parseAddonConfigFields(configSchema);

    if (implementationType === 'module') {
      const key = moduleKey?.trim();

      if (!key) {
        throw new BadRequestException('Module key is required for module addons');
      }

      const module = this.addonModuleRegistry.get(key);

      if (!module) {
        throw new BadRequestException(`Addon module "${key}" is not registered`);
      }

      fieldDefs = module.configFields ?? [];
    } else if (configSchema === undefined && existing) {
      fieldDefs = parseAddonConfigFields(existing.configSchema);
    }

    const allowedKeys = new Set(
      sanitizeAddonConfigFields(fieldDefs, {}).configSchema.environmentVariables.map((f) => f.key),
    );
    const mergedDefaults =
      defaultValues !== undefined
        ? mergeAddonDefaultValues(existing?.configDefaultValues, defaultValues, allowedKeys)
        : existing?.configDefaultValues;

    return sanitizeAddonConfigFields(fieldDefs, mergedDefaults);
  }

  getOrderFieldsForAddon(addon: AddonEntity): CloudInitConfigOrderFieldDto[] {
    return getAddonOrderFields(parseAddonConfigFields(addon.configSchema) as never);
  }

  providerSupportsAddons(providerId: string): boolean {
    const detail = this.providerRegistry.getProviders().find((p) => p.id === providerId);

    return detail?.supportsAddons === true;
  }

  async assertAllowedAddonIdsForPlan(serviceTypeId: string, allowedAddonIds: string[]): Promise<void> {
    if (allowedAddonIds.length === 0) {
      return;
    }

    const serviceType = await this.serviceTypesRepository.findByIdOrThrow(serviceTypeId);

    if (!this.providerSupportsAddons(serviceType.provider)) {
      throw new BadRequestException(
        `Provider "${serviceType.provider}" does not support addons; remove allowedAddonIds from the plan`,
      );
    }

    const addons = await this.addonsRepository.findByIds(allowedAddonIds);

    if (addons.length !== allowedAddonIds.length) {
      throw new BadRequestException('One or more selected addons were not found');
    }

    for (const addon of addons) {
      if (!addon.isActive) {
        throw new BadRequestException(`Addon "${addon.key}" is not active`);
      }

      if (addon.compatibleProviders.length > 0 && !addon.compatibleProviders.includes(serviceType.provider)) {
        throw new BadRequestException(`Addon "${addon.key}" is not compatible with provider "${serviceType.provider}"`);
      }
    }
  }

  async assertAddonIdsForOrder(
    serviceTypeId: string,
    planAllowedAddonIds: string[],
    requestedAddonIds: string[],
  ): Promise<AddonEntity[]> {
    if (requestedAddonIds.length === 0) {
      return [];
    }

    const serviceType = await this.serviceTypesRepository.findByIdOrThrow(serviceTypeId);

    if (!this.providerSupportsAddons(serviceType.provider)) {
      throw new BadRequestException(`Provider "${serviceType.provider}" does not support addons`);
    }

    const allowed = new Set(planAllowedAddonIds);

    for (const id of requestedAddonIds) {
      if (!allowed.has(id)) {
        throw new BadRequestException(`Addon ${id} is not available on this plan`);
      }
    }

    const addons = await this.addonsRepository.findByIds(requestedAddonIds);

    if (addons.length !== requestedAddonIds.length) {
      throw new BadRequestException('One or more selected addons were not found');
    }

    for (const addon of addons) {
      if (!addon.isActive) {
        throw new BadRequestException(`Addon "${addon.key}" is not active`);
      }
    }

    return addons;
  }

  async assertNotReferencedByActivePlans(addonId: string): Promise<void> {
    const referencing: string[] = [];
    let offset = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const plans = await this.servicePlansRepository.findAll(SERVICE_PLAN_REFERENCE_BATCH_SIZE, offset);
      const batchMatches = plans.filter(
        (plan) => plan.isActive && planReferencesAddonId(plan.providerConfigDefaults, addonId),
      );

      referencing.push(...batchMatches.map((plan) => plan.id));

      if (plans.length < SERVICE_PLAN_REFERENCE_BATCH_SIZE) {
        break;
      }

      offset += SERVICE_PLAN_REFERENCE_BATCH_SIZE;
    }

    if (referencing.length > 0) {
      throw new BadRequestException(
        `Addon is referenced by active plan(s): ${referencing.slice(0, 5).join(', ')}${
          referencing.length > 5 ? '…' : ''
        }`,
      );
    }
  }

  async assertNotReferencedBySubscriptions(addonId: string): Promise<void> {
    const count = await this.subscriptionAddonsRepository.countByAddonId(addonId);

    if (count > 0) {
      throw new BadRequestException(`Addon is referenced by ${count} subscription addon row(s) and cannot be deleted`);
    }
  }

  async assertCanDelete(addonId: string): Promise<void> {
    await this.assertNotReferencedByActivePlans(addonId);
    await this.assertNotReferencedBySubscriptions(addonId);
  }

  private validateImplementationPayload(
    implementationType: AddonImplementationType,
    moduleKey?: string | null,
    scriptTemplate?: string | null,
  ): void {
    if (implementationType === 'module') {
      const key = moduleKey?.trim();

      if (!key) {
        throw new BadRequestException('Module key is required for module addons');
      }

      if (!this.addonModuleRegistry.has(key)) {
        throw new BadRequestException(`Addon module "${key}" is not registered`);
      }
    }

    if (implementationType === 'cloud_init_script') {
      if (!scriptTemplate?.trim()) {
        throw new BadRequestException('Script template is required for cloud_init_script addons');
      }
    }
  }

  private validatePricing(
    basePrice?: string | null,
    priceIntervalType?: BillingIntervalType | null,
    priceIntervalValue?: number | null,
  ): void {
    try {
      assertNonNegativeAddonPrice(basePrice);
    } catch {
      throw new BadRequestException('Addon base price must be a non-negative number');
    }

    if (basePrice === undefined || basePrice === null || basePrice === '') {
      return;
    }

    const parsed = Number(basePrice);

    if (parsed > 0) {
      if (!priceIntervalType) {
        throw new BadRequestException('Price interval type is required when base price is set');
      }

      if (!priceIntervalValue || priceIntervalValue < 1) {
        throw new BadRequestException('Price interval value must be at least 1 when base price is set');
      }
    }
  }

  private validateCompatibleProviders(providers?: string[]): void {
    if (!providers || providers.length === 0) {
      return;
    }

    for (const provider of providers) {
      if (!provider.trim()) {
        throw new BadRequestException('Compatible provider ids must be non-empty strings');
      }
    }
  }
}
