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
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';

import { CreateServiceTypeDto } from '../dto/create-service-type.dto';
import { AttachMeterDto, UpdateAttachedMeterDto } from '../dto/meter.dto';
import { AttachedMeterResponseDto } from '../dto/meter-response.dto';
import { ProviderDetailDto } from '../dto/provider-detail.dto';
import { ProviderLocationDto } from '../dto/provider-location.dto';
import { ServerTypeDto } from '../dto/server-type.dto';
import { ServiceTypeResponseDto } from '../dto/service-type-response.dto';
import { UpdateServiceTypeDto } from '../dto/update-service-type.dto';
import { ServiceTypeEntity } from '../entities/service-type.entity';
import { BillingNotificationPublisher } from '../notifications/billing-notification.publisher';
import { ServiceTypesRepository } from '../repositories/service-types.repository';
import { MeterService } from '../services/meter.service';
import { ProviderRegistryService } from '../services/provider-registry.service';
import { ProviderLocationsService } from '../services/provider-locations.service';
import { ProviderServerTypesService } from '../services/provider-server-types.service';
import {
  getProvidersEnvDefaultFieldKeys,
  getProvidersEnvDefaultFields,
  maskProviderDefaultsForResponse,
  normalizeStoredProviderDefaults,
  sanitizeProviderDefaults,
} from '../utils/provider-env-defaults.utils';
import {
  allowedProvidersEqual,
  assertProvidersCompatible,
  normalizeAllowedProviders,
  resolvePrimaryProvider,
  resolveServiceTypeAllowedProviders,
} from '../utils/provider-selection.utils';

@Controller('service-types')
export class ServiceTypesController {
  constructor(
    private readonly serviceTypesRepository: ServiceTypesRepository,
    private readonly providerRegistry: ProviderRegistryService,
    private readonly providerServerTypesService: ProviderServerTypesService,
    private readonly providerLocationsService: ProviderLocationsService,
    private readonly meterService: MeterService,
    private readonly notificationPublisher: BillingNotificationPublisher,
  ) {}

  /**
   * Get server types with specs and pricing for a provider (e.g. hetzner).
   * Used by the billing console to show server type dropdown with price and to auto-set base price.
   */
  @RequireScopes('catalog:read')
  @Get('providers/:providerId/server-types')
  async getProviderServerTypes(
    @Param('providerId') providerId: string,
    @Query('serviceTypeId', new ParseUUIDPipe({ version: '4', optional: true })) serviceTypeId?: string,
  ): Promise<ServerTypeDto[]> {
    let providerDefaults: Record<string, string> | undefined;

    if (serviceTypeId) {
      const serviceType = await this.serviceTypesRepository.findByIdOrThrow(serviceTypeId);
      const allowed = resolveServiceTypeAllowedProviders(serviceType);

      if (!allowed.includes(providerId)) {
        providerDefaults = {};
      } else {
        providerDefaults = normalizeStoredProviderDefaults(serviceType.providerDefaults);
      }
    }

    return this.providerServerTypesService.getServerTypes(providerId, providerDefaults);
  }

  /**
   * Get geography options (locations/regions) with human-readable labels for a provider.
   * Used by the billing console for location/region enum dropdowns.
   */
  @RequireScopes('catalog:read')
  @Get('providers/:providerId/locations')
  async getProviderLocations(
    @Param('providerId') providerId: string,
    @Query('serviceTypeId', new ParseUUIDPipe({ version: '4', optional: true })) serviceTypeId?: string,
  ): Promise<ProviderLocationDto[]> {
    let providerDefaults: Record<string, string> | undefined;

    if (serviceTypeId) {
      const serviceType = await this.serviceTypesRepository.findByIdOrThrow(serviceTypeId);
      const allowed = resolveServiceTypeAllowedProviders(serviceType);

      if (!allowed.includes(providerId)) {
        providerDefaults = {};
      } else {
        providerDefaults = normalizeStoredProviderDefaults(serviceType.providerDefaults);
      }
    }

    return this.providerLocationsService.getLocations(providerId, providerDefaults);
  }

  /**
   * Get all registered provider details (id, displayName, configSchema, compatibilityGroup).
   * Used by clients to build provider selectors and validate provider-specific config.
   */
  @RequireScopes('catalog:read')
  @Get('providers')
  async getProviders(): Promise<ProviderDetailDto[]> {
    return this.providerRegistry.getProviders();
  }

  @RequireScopes('catalog:read')
  @Get()
  async list(
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
    @Query('search') search?: string,
  ): Promise<ServiceTypeResponseDto[]> {
    const rows = await this.serviceTypesRepository.findAll(limit ?? 10, offset ?? 0, search);

    return rows.map((row) => this.mapToResponse(row));
  }

  @RequireScopes('catalog:read')
  @Get(':id')
  async get(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string): Promise<ServiceTypeResponseDto> {
    const row = await this.serviceTypesRepository.findByIdOrThrow(id);

    return this.mapToResponse(row);
  }

  @RequireScopes('catalog:admin')
  @Post()
  @KeycloakRoles(UserRole.ADMIN)
  @UsersRoles(UserRole.ADMIN)
  async create(@Body() dto: CreateServiceTypeDto): Promise<ServiceTypeResponseDto> {
    const { provider, allowedProviders, configSchema } = this.resolveProvidersForPersist(dto);
    const providerDefaults = this.resolveProviderDefaultsForPersist(allowedProviders, dto.providerDefaults, undefined);
    const row = await this.serviceTypesRepository.create({
      key: dto.key,
      name: dto.name,
      description: dto.description,
      provider,
      allowedProviders,
      configSchema,
      isActive: dto.isActive ?? true,
      disallowStatutoryWithdrawal: dto.disallowStatutoryWithdrawal ?? false,
      providerDefaults,
    });

    await this.meterService.syncServiceTypeProviderMeters(row);
    this.notificationPublisher.publishServiceTypeAllowedProvidersChanged({
      serviceTypeId: row.id,
      serviceTypeKey: row.key,
      tenantId: row.tenantId ?? getTenantIdOrDefault(),
      previousPrimary: null,
      previousAllowedProviders: [],
      nextPrimary: provider,
      nextAllowedProviders: allowedProviders,
    });

    return this.mapToResponse(row);
  }

  @RequireScopes('catalog:read')
  @Get(':id/meters')
  async listMeters(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string): Promise<AttachedMeterResponseDto[]> {
    const row = await this.serviceTypesRepository.findByIdOrThrow(id);
    await this.meterService.syncServiceTypeProviderMeters(row);

    return await this.meterService.listServiceTypeMeters(id);
  }

  @RequireScopes('catalog:admin')
  @Post(':id/meters')
  @KeycloakRoles(UserRole.ADMIN)
  @UsersRoles(UserRole.ADMIN)
  async attachMeter(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: AttachMeterDto,
  ): Promise<AttachedMeterResponseDto> {
    await this.serviceTypesRepository.findByIdOrThrow(id);

    return await this.meterService.attachServiceTypeMeter(id, dto.meterId, dto.unitPriceNet, dto.includedUsage);
  }

  @RequireScopes('catalog:admin')
  @Post(':id/meters/:meterId')
  @KeycloakRoles(UserRole.ADMIN)
  @UsersRoles(UserRole.ADMIN)
  async updateMeterAttachment(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('meterId', new ParseUUIDPipe({ version: '4' })) meterId: string,
    @Body() dto: UpdateAttachedMeterDto,
  ): Promise<AttachedMeterResponseDto> {
    await this.serviceTypesRepository.findByIdOrThrow(id);

    return await this.meterService.updateServiceTypeMeter(id, meterId, dto.unitPriceNet, dto.includedUsage);
  }

  @RequireScopes('catalog:admin')
  @Delete(':id/meters/:meterId')
  @KeycloakRoles(UserRole.ADMIN)
  @UsersRoles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async detachMeter(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('meterId', new ParseUUIDPipe({ version: '4' })) meterId: string,
  ): Promise<void> {
    await this.serviceTypesRepository.findByIdOrThrow(id);
    await this.meterService.detachServiceTypeMeter(id, meterId);
  }

  @RequireScopes('catalog:admin')
  @Post(':id')
  @KeycloakRoles(UserRole.ADMIN)
  @UsersRoles(UserRole.ADMIN)
  async update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateServiceTypeDto,
  ): Promise<ServiceTypeResponseDto> {
    const existing = await this.serviceTypesRepository.findByIdOrThrow(id);
    const previousAllowed = resolveServiceTypeAllowedProviders(existing);
    const previousPrimary = existing.provider?.trim() || previousAllowed[0] || null;
    const providersTouched = dto.allowedProviders !== undefined || dto.provider !== undefined;
    const resolved = providersTouched
      ? this.resolveProvidersForPersist({
          provider: dto.provider !== undefined ? dto.provider : existing.provider,
          allowedProviders: dto.allowedProviders !== undefined ? dto.allowedProviders : previousAllowed,
          configSchema: dto.configSchema,
        })
      : {
          provider: existing.provider,
          allowedProviders: previousAllowed,
          configSchema: dto.configSchema ?? existing.configSchema ?? {},
        };
    const providersChanged =
      previousPrimary !== resolved.provider || !allowedProvidersEqual(previousAllowed, resolved.allowedProviders);
    const providerDefaults = this.resolveProviderDefaultsForPersist(
      resolved.allowedProviders,
      dto.providerDefaults,
      normalizeStoredProviderDefaults(existing.providerDefaults),
      providersChanged,
    );
    const row = await this.serviceTypesRepository.update(id, {
      name: dto.name,
      description: dto.description,
      ...(providersTouched
        ? {
            provider: resolved.provider,
            allowedProviders: resolved.allowedProviders,
            configSchema: resolved.configSchema,
          }
        : dto.configSchema !== undefined
          ? { configSchema: dto.configSchema }
          : {}),
      isActive: dto.isActive,
      disallowStatutoryWithdrawal: dto.disallowStatutoryWithdrawal,
      ...(providerDefaults !== undefined ? { providerDefaults } : {}),
    });

    await this.meterService.syncServiceTypeProviderMeters(row);

    if (providersChanged) {
      this.notificationPublisher.publishServiceTypeAllowedProvidersChanged({
        serviceTypeId: row.id,
        serviceTypeKey: row.key,
        tenantId: row.tenantId ?? getTenantIdOrDefault(),
        previousPrimary,
        previousAllowedProviders: previousAllowed,
        nextPrimary: resolved.provider,
        nextAllowedProviders: resolved.allowedProviders,
      });
    }

    return this.mapToResponse(row);
  }

  @RequireScopes('catalog:admin')
  @Delete(':id')
  @KeycloakRoles(UserRole.ADMIN)
  @UsersRoles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    await this.serviceTypesRepository.delete(id);
  }

  private resolveProvidersForPersist(dto: {
    provider?: string | null;
    allowedProviders?: string[];
    configSchema?: Record<string, unknown>;
  }): { provider: string | null; allowedProviders: string[]; configSchema: Record<string, unknown> } {
    let allowedProviders = normalizeAllowedProviders(dto.allowedProviders);

    if (allowedProviders.length === 0) {
      const legacy = typeof dto.provider === 'string' ? dto.provider.trim() : '';

      if (legacy) {
        allowedProviders = [legacy];
      }
    }

    // Non-empty allowlist wins over a null/empty provider field (primary is derived from the list).
    // None is represented only by an empty allowlist (and null primary).

    const compatibilityError = assertProvidersCompatible(allowedProviders, (id) =>
      this.providerRegistry.getProvider(id),
    );

    if (compatibilityError) {
      throw new BadRequestException(compatibilityError);
    }

    const provider = resolvePrimaryProvider(allowedProviders);
    let configSchema = dto.configSchema ?? {};

    if (provider) {
      const registered = this.providerRegistry.getProvider(provider)?.configSchema;

      if (registered && (!dto.configSchema || Object.keys(dto.configSchema).length === 0)) {
        configSchema = { ...registered };
      }
    } else {
      configSchema = dto.configSchema ?? {};
    }

    return { provider, allowedProviders, configSchema };
  }

  private resolveProviderDefaultsForPersist(
    allowedProviders: string[],
    input: Record<string, string> | undefined,
    existing: Record<string, string> | undefined,
    providersChanged = false,
  ): Record<string, string> | undefined {
    const allowedKeys = getProvidersEnvDefaultFieldKeys(allowedProviders);

    if (input !== undefined) {
      return sanitizeProviderDefaults(input, allowedKeys);
    }

    if (providersChanged && existing) {
      return sanitizeProviderDefaults(existing, allowedKeys);
    }

    return undefined;
  }

  private mapToResponse(row: ServiceTypeEntity): ServiceTypeResponseDto {
    const allowedProviders = resolveServiceTypeAllowedProviders(row);
    const providerDefaults = normalizeStoredProviderDefaults(row.providerDefaults);
    const { providerDefaultsConfigured } = maskProviderDefaultsForResponse(
      providerDefaults,
      getProvidersEnvDefaultFields(allowedProviders),
    );

    return {
      id: row.id,
      key: row.key,
      name: row.name,
      description: row.description,
      provider: row.provider?.trim() ? row.provider : (allowedProviders[0] ?? null),
      allowedProviders,
      configSchema: row.configSchema ?? {},
      isActive: row.isActive,
      disallowStatutoryWithdrawal: row.disallowStatutoryWithdrawal,
      providerDefaultsConfigured,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
