import { KeycloakRoles, UserRole, UsersRoles } from '@forepath/identity/backend';
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
import { ServicePlanResponseDto } from '../dto/service-plan-response.dto';
import { UpdateServicePlanDto } from '../dto/update-service-plan.dto';
import { ServicePlanEntity } from '../entities/service-plan.entity';
import { ServicePlansRepository } from '../repositories/service-plans.repository';
import { ServiceTypesRepository } from '../repositories/service-types.repository';
import { ProviderRegistryService } from '../services/provider-registry.service';
import { effectiveSchemaSupportsLocationSelection } from '../utils/provider-location.utils';

@Controller('service-plans')
export class ServicePlansController {
  constructor(
    private readonly servicePlansRepository: ServicePlansRepository,
    private readonly serviceTypesRepository: ServiceTypesRepository,
    private readonly providerRegistry: ProviderRegistryService,
  ) {}

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

    return rows.map((row) => this.mapToResponse(row));
  }

  @Get(':id')
  async get(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string): Promise<ServicePlanResponseDto> {
    const row = await this.servicePlansRepository.findByIdOrThrow(id);

    return this.mapToResponse(row);
  }

  @Post()
  @KeycloakRoles(UserRole.ADMIN)
  @UsersRoles(UserRole.ADMIN)
  async create(@Body() dto: CreateServicePlanDto): Promise<ServicePlanResponseDto> {
    await this.assertAllowLocationAllowed(dto.serviceTypeId, dto.allowCustomerLocationSelection === true);
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
      providerConfigDefaults: dto.providerConfigDefaults ?? {},
      orderingHighlights: dto.orderingHighlights ?? [],
      allowCustomerLocationSelection: dto.allowCustomerLocationSelection ?? false,
      isActive: dto.isActive ?? true,
    });

    return this.mapToResponse(row);
  }

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
      providerConfigDefaults: dto.providerConfigDefaults,
      ...(dto.orderingHighlights !== undefined ? { orderingHighlights: dto.orderingHighlights } : {}),
      ...(dto.allowCustomerLocationSelection !== undefined
        ? { allowCustomerLocationSelection: dto.allowCustomerLocationSelection }
        : {}),
      isActive: dto.isActive,
    });

    return this.mapToResponse(row);
  }

  @Delete(':id')
  @KeycloakRoles(UserRole.ADMIN)
  @UsersRoles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    await this.servicePlansRepository.delete(id);
  }

  private mapToResponse(row: ServicePlanEntity): ServicePlanResponseDto {
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
}
