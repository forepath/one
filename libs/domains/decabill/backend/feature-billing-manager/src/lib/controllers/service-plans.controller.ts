import { KeycloakRoles, RequireScopes, UserRole, UsersRoles } from '@forepath/identity/backend';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';

import { CreateServicePlanDto } from '../dto/create-service-plan.dto';
import { CloudInitConfigOrderFieldDto } from '../dto/cloud-init-config-response.dto';
import { OrderProvisioningOptionDto } from '../dto/order-provisioning-option.dto';
import { ServicePlanResponseDto } from '../dto/service-plan-response.dto';
import { UpdateServicePlanDto } from '../dto/update-service-plan.dto';
import { ServicePlanEntity } from '../entities/service-plan.entity';
import { TaxCategory } from '../constants/tax-category.constants';
import { ServicePlansRepository } from '../repositories/service-plans.repository';
import { ServiceTypesRepository } from '../repositories/service-types.repository';
import { CloudInitConfigService } from '../services/cloud-init-config.service';
import { ProviderRegistryService } from '../services/provider-registry.service';
import { WithdrawalPolicyService } from '../services/withdrawal-policy.service';
import { normalizePlanProviderConfigDefaults } from '../utils/cloud-init/plan-provisioning-options.utils';
import { effectiveSchemaSupportsLocationSelection } from '../utils/provider-location.utils';
import {
  effectiveSchemaSupportsServerTypeSelection,
  normalizeAllowedServerTypes,
} from '../utils/provider-server-type.utils';

@Controller('service-plans')
export class ServicePlansController {
  constructor(
    private readonly servicePlansRepository: ServicePlansRepository,
    private readonly serviceTypesRepository: ServiceTypesRepository,
    private readonly providerRegistry: ProviderRegistryService,
    private readonly cloudInitConfigService: CloudInitConfigService,
    private readonly withdrawalPolicyService: WithdrawalPolicyService,
  ) {}

  @RequireScopes('subscriptions:read')
  @Get()
  async list(
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
    @Query('serviceTypeId') serviceTypeId?: string,
  ): Promise<ServicePlanResponseDto[]> {
    let rows = await this.servicePlansRepository.findAll(limit ?? 10, offset ?? 0);

    if (serviceTypeId) {
      rows = rows.filter((row) => row.serviceTypeId === serviceTypeId);
    }

    return await Promise.all(rows.map((row) => this.mapToResponse(row)));
  }

  @RequireScopes('subscriptions:read')
  @Get(':id/order-provisioning-options')
  async listOrderProvisioningOptions(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<OrderProvisioningOptionDto[]> {
    const row = await this.servicePlansRepository.findByIdOrThrow(id);

    return this.cloudInitConfigService.buildOrderProvisioningOptions(row.providerConfigDefaults ?? {});
  }

  @RequireScopes('subscriptions:read')
  @Get(':id/cloud-init-configs/:configId/order-fields')
  async getCloudInitOrderFields(
    @Param('id', new ParseUUIDPipe({ version: '4' })) planId: string,
    @Param('configId', new ParseUUIDPipe({ version: '4' })) configId: string,
  ): Promise<CloudInitConfigOrderFieldDto[]> {
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
    await this.assertAllowLocationAllowed(dto.serviceTypeId, dto.allowCustomerLocationSelection === true);
    await this.assertAllowServerTypeAllowed(
      dto.serviceTypeId,
      dto.allowCustomerServerTypeSelection === true,
      dto.allowedServerTypes,
    );
    const normalizedDefaults = normalizePlanProviderConfigDefaults(dto.providerConfigDefaults);
    const allowCustomerServerTypeSelection = dto.allowCustomerServerTypeSelection === true;
    const allowedServerTypes = allowCustomerServerTypeSelection
      ? normalizeAllowedServerTypes(dto.allowedServerTypes)
      : [];

    await this.cloudInitConfigService.assertActiveConfigForPlanDefaults(dto.serviceTypeId, normalizedDefaults);
    const row = await this.servicePlansRepository.create({
      serviceTypeId: dto.serviceTypeId,
      name: dto.name,
      description: dto.description,
      billingIntervalType: dto.billingIntervalType,
      billingIntervalValue: dto.billingIntervalValue,
      billingDayOfMonth: dto.billingDayOfMonth,
      cancelAtPeriodEnd: dto.cancelAtPeriodEnd ?? true,
      minCommitmentDays: dto.minCommitmentDays ?? 0,
      noticeDays: dto.noticeDays ?? 0,
      basePrice: dto.basePrice,
      marginPercent: dto.marginPercent,
      marginFixed: dto.marginFixed,
      providerConfigDefaults: normalizedDefaults ?? {},
      orderingHighlights: dto.orderingHighlights ?? [],
      allowCustomerLocationSelection: dto.allowCustomerLocationSelection ?? false,
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

    const allowCustomerServerTypeSelection =
      dto.allowCustomerServerTypeSelection !== undefined
        ? dto.allowCustomerServerTypeSelection === true
        : existing.allowCustomerServerTypeSelection === true;
    const allowedServerTypes =
      dto.allowedServerTypes !== undefined
        ? allowCustomerServerTypeSelection
          ? normalizeAllowedServerTypes(dto.allowedServerTypes)
          : []
        : allowCustomerServerTypeSelection
          ? normalizeAllowedServerTypes(existing.allowedServerTypes)
          : [];

    if (dto.providerConfigDefaults !== undefined) {
      const normalizedDefaults = normalizePlanProviderConfigDefaults(dto.providerConfigDefaults);

      await this.cloudInitConfigService.assertActiveConfigForPlanDefaults(existing.serviceTypeId, normalizedDefaults);
    }

    const row = await this.servicePlansRepository.update(id, {
      name: dto.name,
      description: dto.description,
      billingIntervalType: dto.billingIntervalType,
      billingIntervalValue: dto.billingIntervalValue,
      billingDayOfMonth: dto.billingDayOfMonth,
      cancelAtPeriodEnd: dto.cancelAtPeriodEnd,
      minCommitmentDays: dto.minCommitmentDays,
      noticeDays: dto.noticeDays,
      basePrice: dto.basePrice,
      marginPercent: dto.marginPercent,
      marginFixed: dto.marginFixed,
      providerConfigDefaults:
        dto.providerConfigDefaults !== undefined
          ? normalizePlanProviderConfigDefaults(dto.providerConfigDefaults)
          : undefined,
      ...(dto.orderingHighlights !== undefined ? { orderingHighlights: dto.orderingHighlights } : {}),
      ...(dto.allowCustomerLocationSelection !== undefined
        ? { allowCustomerLocationSelection: dto.allowCustomerLocationSelection }
        : {}),
      ...(dto.allowCustomerServerTypeSelection !== undefined
        ? { allowCustomerServerTypeSelection: dto.allowCustomerServerTypeSelection }
        : {}),
      ...(dto.allowedServerTypes !== undefined || dto.allowCustomerServerTypeSelection !== undefined
        ? { allowedServerTypes }
        : {}),
      ...(dto.taxCategory !== undefined ? { taxCategory: dto.taxCategory } : {}),
      isActive: dto.isActive,
    });

    return await this.mapToResponse(row);
  }

  @RequireScopes('catalog:write')
  @Delete(':id')
  @KeycloakRoles(UserRole.ADMIN)
  @UsersRoles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    await this.servicePlansRepository.delete(id);
  }

  private async mapToResponse(row: ServicePlanEntity): Promise<ServicePlanResponseDto> {
    const serviceType = await this.serviceTypesRepository.findByIdOrThrow(row.serviceTypeId);

    return {
      id: row.id,
      serviceTypeId: row.serviceTypeId,
      name: row.name,
      description: row.description,
      billingIntervalType: row.billingIntervalType,
      billingIntervalValue: row.billingIntervalValue,
      billingDayOfMonth: row.billingDayOfMonth,
      cancelAtPeriodEnd: row.cancelAtPeriodEnd,
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
      withdrawalPolicy: this.withdrawalPolicyService.buildPolicyInfo(serviceType),
      isActive: row.isActive,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
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
