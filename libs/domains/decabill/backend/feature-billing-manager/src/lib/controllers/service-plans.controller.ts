import { KeycloakRoles, RequireScopes, UserRole, UsersRoles } from '@forepath/identity/backend';
import { getTenantIdOrDefault } from '@forepath/shared/backend';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { randomUUID } from 'crypto';

import { CreateServicePlanDto } from '../dto/create-service-plan.dto';
import { CloudInitConfigOrderFieldDto } from '../dto/cloud-init-config-response.dto';
import { PlanAddonOptionDto } from '../dto/addon-response.dto';
import { OrderProvisioningOptionDto } from '../dto/order-provisioning-option.dto';
import { ServicePlanResponseDto } from '../dto/service-plan-response.dto';
import { UpdateServicePlanDto } from '../dto/update-service-plan.dto';
import { ServicePlanEntity } from '../entities/service-plan.entity';
import { fromApiServiceTypeId, isNoneServiceTypeId, toApiServiceTypeId } from '../constants/service-type-id.constants';
import { TaxCategory } from '../constants/tax-category.constants';
import { AddonsRepository } from '../repositories/addons.repository';
import { ServicePlansRepository } from '../repositories/service-plans.repository';
import { ServiceTypesRepository } from '../repositories/service-types.repository';
import { SubscriptionsRepository } from '../repositories/subscriptions.repository';
import { AddonService } from '../services/addon.service';
import { CloudInitConfigService } from '../services/cloud-init-config.service';
import { MeterService } from '../services/meter.service';
import { ProviderRegistryService } from '../services/provider-registry.service';
import { WithdrawalPolicyService } from '../services/withdrawal-policy.service';
import { AttachMeterDto, UpdateAttachedMeterDto } from '../dto/meter.dto';
import { AttachedMeterResponseDto } from '../dto/meter-response.dto';
import {
  PLAN_PRICE_MIGRATE_ENQUEUE,
  type PlanPriceMigrateEnqueuePort,
} from '../queue/plan-price-migrate-enqueue.token';
import { convertAddonPriceToPlanPeriod } from '../utils/addon-pricing.util';
import { normalizePlanProviderConfigDefaults } from '../utils/cloud-init/plan-provisioning-options.utils';
import { parsePlanAllowedAddonIds } from '../utils/plan-addons.utils';
import { commercialPricingFieldsChanged, snapshotCommercialPricing } from '../utils/plan-commercial-pricing.utils';
import { isPostgresForeignKeyViolation } from '../utils/postgres-foreign-key-violation.util';
import { effectiveSchemaSupportsLocationSelection } from '../utils/provider-location.utils';
import {
  effectiveSchemaSupportsServerTypeSelection,
  normalizeAllowedServerTypes,
} from '../utils/provider-server-type.utils';

@Controller('service-plans')
export class ServicePlansController {
  private readonly logger = new Logger(ServicePlansController.name);

  constructor(
    private readonly servicePlansRepository: ServicePlansRepository,
    private readonly serviceTypesRepository: ServiceTypesRepository,
    private readonly providerRegistry: ProviderRegistryService,
    private readonly cloudInitConfigService: CloudInitConfigService,
    private readonly addonService: AddonService,
    private readonly meterService: MeterService,
    private readonly addonsRepository: AddonsRepository,
    private readonly subscriptionsRepository: SubscriptionsRepository,
    private readonly withdrawalPolicyService: WithdrawalPolicyService,
    @Inject(PLAN_PRICE_MIGRATE_ENQUEUE)
    private readonly planPriceMigrateEnqueue: PlanPriceMigrateEnqueuePort,
  ) {}

  @RequireScopes('subscriptions:read')
  @Get()
  async list(
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
    @Query('serviceTypeId') serviceTypeId?: string,
  ): Promise<ServicePlanResponseDto[]> {
    let rows = await this.servicePlansRepository.findAll(limit ?? 10, offset ?? 0);

    if (serviceTypeId !== undefined) {
      const dbTypeId = isNoneServiceTypeId(serviceTypeId) ? null : serviceTypeId.trim();

      rows = rows.filter((row) => row.serviceTypeId === dbTypeId);
    }

    return await Promise.all(rows.map((row) => this.mapToResponse(row)));
  }

  @RequireScopes('subscriptions:read')
  @Get(':id/order-provisioning-options')
  async listOrderProvisioningOptions(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<OrderProvisioningOptionDto[]> {
    const row = await this.servicePlansRepository.findByIdOrThrow(id);

    if (!row.serviceTypeId) {
      return [];
    }

    return this.cloudInitConfigService.buildOrderProvisioningOptions(row.providerConfigDefaults ?? {});
  }

  @RequireScopes('subscriptions:read')
  @Get(':id/meters')
  async listPlanMeters(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<AttachedMeterResponseDto[]> {
    const plan = await this.servicePlansRepository.findByIdOrThrow(id);

    return await this.meterService.listEffectivePlanMeters(id, plan.serviceTypeId);
  }

  @RequireScopes('catalog:write')
  @Post(':id/meters')
  @KeycloakRoles(UserRole.ADMIN)
  @UsersRoles(UserRole.ADMIN)
  async attachPlanMeter(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: AttachMeterDto,
  ): Promise<AttachedMeterResponseDto> {
    await this.servicePlansRepository.findByIdOrThrow(id);

    return await this.meterService.attachPlanMeter(id, dto.meterId, dto.unitPriceNet);
  }

  @RequireScopes('catalog:write')
  @Post(':id/meters/:meterId')
  @KeycloakRoles(UserRole.ADMIN)
  @UsersRoles(UserRole.ADMIN)
  async updatePlanMeter(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('meterId', new ParseUUIDPipe({ version: '4' })) meterId: string,
    @Body() dto: UpdateAttachedMeterDto,
  ): Promise<AttachedMeterResponseDto> {
    await this.servicePlansRepository.findByIdOrThrow(id);

    return await this.meterService.updatePlanMeter(id, meterId, dto.unitPriceNet);
  }

  @RequireScopes('catalog:write')
  @Delete(':id/meters/:meterId')
  @KeycloakRoles(UserRole.ADMIN)
  @UsersRoles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async detachPlanMeter(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('meterId', new ParseUUIDPipe({ version: '4' })) meterId: string,
  ): Promise<void> {
    await this.servicePlansRepository.findByIdOrThrow(id);
    await this.meterService.detachPlanMeter(id, meterId);
  }

  @RequireScopes('subscriptions:read')
  @Get(':id/addons')
  async listOrderAddons(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string): Promise<PlanAddonOptionDto[]> {
    const plan = await this.servicePlansRepository.findByIdOrThrow(id);

    if (!plan.serviceTypeId) {
      return [];
    }

    const serviceType = await this.serviceTypesRepository.findByIdOrThrow(plan.serviceTypeId);

    if (!this.addonService.providerSupportsAddons(serviceType.provider)) {
      return [];
    }

    const allowedIds = parsePlanAllowedAddonIds(plan.providerConfigDefaults);

    if (allowedIds.length === 0) {
      return [];
    }

    const addons = await this.addonsRepository.findByIds(allowedIds);

    const compatible = addons
      .filter((addon) => addon.isActive)
      .filter(
        (addon) => addon.compatibleProviders.length === 0 || addon.compatibleProviders.includes(serviceType.provider),
      );

    return await Promise.all(
      compatible.map(async (addon) => ({
        id: addon.id,
        key: addon.key,
        name: addon.name,
        description: addon.description ?? null,
        implementationType: addon.implementationType,
        basePrice: addon.basePrice ?? null,
        priceIntervalType: addon.priceIntervalType ?? null,
        priceIntervalValue: addon.priceIntervalValue ?? null,
        periodPrice: convertAddonPriceToPlanPeriod(addon, plan),
        orderFields: this.addonService.getOrderFieldsForAddon(addon),
        meters: await this.meterService.listAddonMeters(addon.id),
      })),
    );
  }

  @RequireScopes('subscriptions:read')
  @Get(':id/cloud-init-configs/:configId/order-fields')
  async getCloudInitOrderFields(
    @Param('id', new ParseUUIDPipe({ version: '4' })) planId: string,
    @Param('configId', new ParseUUIDPipe({ version: '4' })) configId: string,
  ): Promise<CloudInitConfigOrderFieldDto[]> {
    const plan = await this.servicePlansRepository.findByIdOrThrow(planId);

    if (!plan.serviceTypeId) {
      return [];
    }

    return this.cloudInitConfigService.getOrderFieldsForPlan(planId, configId);
  }

  @RequireScopes('subscriptions:read')
  @Get(':id')
  async get(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string): Promise<ServicePlanResponseDto> {
    const row = await this.servicePlansRepository.findByIdOrThrow(id);

    return await this.mapToResponse(row);
  }

  @RequireScopes('catalog:write')
  @Post()
  @KeycloakRoles(UserRole.ADMIN)
  @UsersRoles(UserRole.ADMIN)
  async create(@Body() dto: CreateServicePlanDto): Promise<ServicePlanResponseDto> {
    const dbServiceTypeId = fromApiServiceTypeId(dto.serviceTypeId);
    const isNone = dbServiceTypeId == null;

    if (isNone) {
      this.assertNonePlanConstraints(dto);
    } else {
      await this.assertAllowLocationAllowed(dbServiceTypeId, dto.allowCustomerLocationSelection === true);
      await this.assertAllowServerTypeAllowed(
        dbServiceTypeId,
        dto.allowCustomerServerTypeSelection === true,
        dto.allowedServerTypes,
      );
    }

    const normalizedDefaults = isNone ? {} : normalizePlanProviderConfigDefaults(dto.providerConfigDefaults);
    const allowCustomerServerTypeSelection = isNone ? false : dto.allowCustomerServerTypeSelection === true;
    const allowedServerTypes = allowCustomerServerTypeSelection
      ? normalizeAllowedServerTypes(dto.allowedServerTypes)
      : [];

    if (!isNone && dbServiceTypeId) {
      await this.cloudInitConfigService.assertActiveConfigForPlanDefaults(dbServiceTypeId, normalizedDefaults);
      await this.addonService.assertAllowedAddonIdsForPlan(
        dbServiceTypeId,
        parsePlanAllowedAddonIds(normalizedDefaults),
      );
    }

    const row = await this.servicePlansRepository.create({
      serviceTypeId: dbServiceTypeId,
      tenantId: getTenantIdOrDefault(),
      name: dto.name,
      description: dto.description,
      billingIntervalType: dto.billingIntervalType,
      billingIntervalValue: dto.billingIntervalValue,
      billingDayOfMonth: dto.billingDayOfMonth,
      cancelAtPeriodEnd: dto.cancelAtPeriodEnd ?? true,
      billInAdvance: dto.billInAdvance ?? false,
      autoRecalculatePriceDaily: isNone ? false : (dto.autoRecalculatePriceDaily ?? false),
      minCommitmentDays: dto.minCommitmentDays ?? 0,
      noticeDays: dto.noticeDays ?? 0,
      basePrice: dto.basePrice,
      marginPercent: dto.marginPercent,
      marginFixed: dto.marginFixed,
      providerConfigDefaults: normalizedDefaults ?? {},
      orderingHighlights: dto.orderingHighlights ?? [],
      allowCustomerLocationSelection: isNone ? false : (dto.allowCustomerLocationSelection ?? false),
      allowCustomerServerTypeSelection,
      allowedServerTypes,
      taxCategory: dto.taxCategory ?? TaxCategory.STANDARD,
      isActive: dto.isActive ?? true,
    });

    return await this.mapToResponse(row);
  }

  @RequireScopes('catalog:write')
  @Post(':id')
  @KeycloakRoles(UserRole.ADMIN)
  @UsersRoles(UserRole.ADMIN)
  async update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateServicePlanDto,
  ): Promise<ServicePlanResponseDto> {
    const existing = await this.servicePlansRepository.findByIdOrThrow(id);
    const isNone = !existing.serviceTypeId;

    if (isNone) {
      this.assertNonePlanUpdateConstraints(dto);
    }

    if (!isNone && existing.serviceTypeId) {
      if (dto.allowCustomerLocationSelection === true) {
        await this.assertAllowLocationAllowed(existing.serviceTypeId, true);
      }

      if (dto.allowCustomerServerTypeSelection === true) {
        await this.assertAllowServerTypeAllowed(
          existing.serviceTypeId,
          true,
          dto.allowedServerTypes ?? existing.allowedServerTypes,
        );
      }
    }

    const allowCustomerServerTypeSelection = isNone
      ? false
      : dto.allowCustomerServerTypeSelection !== undefined
        ? dto.allowCustomerServerTypeSelection === true
        : existing.allowCustomerServerTypeSelection === true;
    const allowedServerTypes = isNone
      ? []
      : dto.allowedServerTypes !== undefined
        ? allowCustomerServerTypeSelection
          ? normalizeAllowedServerTypes(dto.allowedServerTypes)
          : []
        : allowCustomerServerTypeSelection
          ? normalizeAllowedServerTypes(existing.allowedServerTypes)
          : [];

    if (!isNone && existing.serviceTypeId && dto.providerConfigDefaults !== undefined) {
      const normalizedDefaults = normalizePlanProviderConfigDefaults(dto.providerConfigDefaults);

      await this.cloudInitConfigService.assertActiveConfigForPlanDefaults(existing.serviceTypeId, normalizedDefaults);
      await this.addonService.assertAllowedAddonIdsForPlan(
        existing.serviceTypeId,
        parsePlanAllowedAddonIds(normalizedDefaults),
      );
    }

    const shouldMigrate = dto.migrateExistingSubscriptions === true && commercialPricingFieldsChanged(existing, dto);
    const previousPricing = shouldMigrate ? snapshotCommercialPricing(existing) : null;

    // Only assign defined DTO fields — Object.assign + TypeORM save would otherwise persist `undefined` as NULL
    // and wipe commercial pricing on partial admin updates (e.g. marginFixed-only + migrateExistingSubscriptions).
    const row = await this.servicePlansRepository.update(id, {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.billingIntervalType !== undefined ? { billingIntervalType: dto.billingIntervalType } : {}),
      ...(dto.billingIntervalValue !== undefined ? { billingIntervalValue: dto.billingIntervalValue } : {}),
      ...(dto.billingDayOfMonth !== undefined ? { billingDayOfMonth: dto.billingDayOfMonth } : {}),
      ...(dto.cancelAtPeriodEnd !== undefined ? { cancelAtPeriodEnd: dto.cancelAtPeriodEnd } : {}),
      ...(dto.billInAdvance !== undefined ? { billInAdvance: dto.billInAdvance } : {}),
      ...(dto.autoRecalculatePriceDaily !== undefined
        ? { autoRecalculatePriceDaily: isNone ? false : dto.autoRecalculatePriceDaily }
        : {}),
      ...(dto.minCommitmentDays !== undefined ? { minCommitmentDays: dto.minCommitmentDays } : {}),
      ...(dto.noticeDays !== undefined ? { noticeDays: dto.noticeDays } : {}),
      ...(dto.basePrice !== undefined ? { basePrice: dto.basePrice } : {}),
      ...(dto.marginPercent !== undefined ? { marginPercent: dto.marginPercent } : {}),
      ...(dto.marginFixed !== undefined ? { marginFixed: dto.marginFixed } : {}),
      ...(dto.providerConfigDefaults !== undefined
        ? {
            providerConfigDefaults: isNone ? {} : normalizePlanProviderConfigDefaults(dto.providerConfigDefaults),
          }
        : {}),
      ...(dto.orderingHighlights !== undefined ? { orderingHighlights: dto.orderingHighlights } : {}),
      ...(dto.allowCustomerLocationSelection !== undefined
        ? { allowCustomerLocationSelection: isNone ? false : dto.allowCustomerLocationSelection }
        : {}),
      ...(dto.allowCustomerServerTypeSelection !== undefined || isNone ? { allowCustomerServerTypeSelection } : {}),
      ...(dto.allowedServerTypes !== undefined || dto.allowCustomerServerTypeSelection !== undefined || isNone
        ? { allowedServerTypes }
        : {}),
      ...(dto.taxCategory !== undefined ? { taxCategory: dto.taxCategory } : {}),
      ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
    });

    if (shouldMigrate && previousPricing) {
      const changeId = randomUUID();
      const runDate = new Intl.DateTimeFormat('en-CA', {
        timeZone: process.env.BILLING_PRICE_RECALC_TIMEZONE ?? 'Europe/Berlin',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());

      try {
        await this.planPriceMigrateEnqueue.enqueueUnit({
          tenantId: getTenantIdOrDefault(),
          planId: id,
          changeId,
          runDate,
          previousPricing,
        });
      } catch (error) {
        this.logger.error(`Failed to enqueue plan price migration for service plan ${id}: ${(error as Error).message}`);
      }
    }

    return await this.mapToResponse(row);
  }

  @RequireScopes('catalog:write')
  @Delete(':id')
  @KeycloakRoles(UserRole.ADMIN)
  @UsersRoles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    await this.servicePlansRepository.findByIdOrThrow(id);

    const subscriptionCount = await this.subscriptionsRepository.countByPlanId(id);

    if (subscriptionCount > 0) {
      throw new BadRequestException(
        `Service plan is referenced by ${subscriptionCount} subscription(s) and cannot be deleted`,
      );
    }

    try {
      await this.servicePlansRepository.delete(id);
    } catch (error: unknown) {
      if (isPostgresForeignKeyViolation(error)) {
        this.logger.warn(`Blocked delete of service plan ${id}: still referenced by subscriptions`);
        throw new BadRequestException('Service plan is referenced by subscriptions and cannot be deleted');
      }

      throw error;
    }
  }

  private async mapToResponse(row: ServicePlanEntity): Promise<ServicePlanResponseDto> {
    const withdrawalPolicy = row.serviceTypeId
      ? this.withdrawalPolicyService.buildPolicyInfo(
          await this.serviceTypesRepository.findByIdOrThrow(row.serviceTypeId),
        )
      : this.withdrawalPolicyService.buildPolicyInfo({ disallowStatutoryWithdrawal: false });

    return {
      id: row.id,
      serviceTypeId: toApiServiceTypeId(row.serviceTypeId),
      name: row.name,
      description: row.description,
      billingIntervalType: row.billingIntervalType,
      billingIntervalValue: row.billingIntervalValue,
      billingDayOfMonth: row.billingDayOfMonth,
      cancelAtPeriodEnd: row.cancelAtPeriodEnd,
      billInAdvance: row.billInAdvance === true,
      autoRecalculatePriceDaily: row.autoRecalculatePriceDaily === true,
      minCommitmentDays: row.minCommitmentDays,
      noticeDays: row.noticeDays,
      basePrice: row.basePrice,
      marginPercent: row.marginPercent,
      marginFixed: row.marginFixed,
      providerConfigDefaults: row.providerConfigDefaults ?? {},
      orderingHighlights: row.orderingHighlights ?? [],
      allowCustomerLocationSelection: row.allowCustomerLocationSelection === true,
      allowCustomerServerTypeSelection: row.allowCustomerServerTypeSelection === true,
      allowedServerTypes: normalizeAllowedServerTypes(row.allowedServerTypes),
      taxCategory: row.taxCategory ?? TaxCategory.STANDARD,
      withdrawalPolicy,
      meters: await this.meterService.listEffectivePlanMeters(row.id, row.serviceTypeId),
      isActive: row.isActive,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private assertNonePlanConstraints(dto: CreateServicePlanDto): void {
    if (dto.allowCustomerLocationSelection === true) {
      throw new BadRequestException(
        'allowCustomerLocationSelection is not supported when serviceTypeId is null (no deployment)',
      );
    }

    if (dto.allowCustomerServerTypeSelection === true) {
      throw new BadRequestException(
        'allowCustomerServerTypeSelection is not supported when serviceTypeId is null (no deployment)',
      );
    }

    if (dto.autoRecalculatePriceDaily === true) {
      throw new BadRequestException(
        'autoRecalculatePriceDaily is not supported when serviceTypeId is null (no deployment)',
      );
    }
  }

  private assertNonePlanUpdateConstraints(dto: UpdateServicePlanDto): void {
    if (dto.allowCustomerLocationSelection === true) {
      throw new BadRequestException(
        'allowCustomerLocationSelection is not supported when serviceTypeId is null (no deployment)',
      );
    }

    if (dto.allowCustomerServerTypeSelection === true) {
      throw new BadRequestException(
        'allowCustomerServerTypeSelection is not supported when serviceTypeId is null (no deployment)',
      );
    }

    if (dto.autoRecalculatePriceDaily === true) {
      throw new BadRequestException(
        'autoRecalculatePriceDaily is not supported when serviceTypeId is null (no deployment)',
      );
    }
  }

  private async assertAllowLocationAllowed(serviceTypeId: string, allow: boolean): Promise<void> {
    if (!allow) return;

    const serviceType = await this.serviceTypesRepository.findByIdOrThrow(serviceTypeId);
    const providerDetail = this.providerRegistry.getProviders().find((p) => p.id === serviceType.provider);

    if (!effectiveSchemaSupportsLocationSelection(serviceType.configSchema, providerDetail?.configSchema)) {
      throw new BadRequestException(
        'allowCustomerLocationSelection requires region or location with a string enum on the service type config schema or on the provider registered for this service type',
      );
    }
  }

  private async assertAllowServerTypeAllowed(
    serviceTypeId: string,
    allow: boolean,
    allowedServerTypes: string[] | undefined,
  ): Promise<void> {
    if (!allow) return;

    const serviceType = await this.serviceTypesRepository.findByIdOrThrow(serviceTypeId);
    const providerDetail = this.providerRegistry.getProviders().find((p) => p.id === serviceType.provider);

    if (!effectiveSchemaSupportsServerTypeSelection(serviceType.configSchema, providerDetail?.configSchema)) {
      throw new BadRequestException(
        'allowCustomerServerTypeSelection requires basePriceFromField serverType on the service type config schema or on the provider registered for this service type',
      );
    }

    const normalized = normalizeAllowedServerTypes(allowedServerTypes);

    if (normalized.length === 0) {
      throw new BadRequestException(
        'allowedServerTypes must contain at least one server type when customer selection is enabled',
      );
    }
  }
}
