import { KeycloakRoles, UserRole, UsersRoles } from '@forepath/identity/backend';
import {
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
import { ProviderDetailDto } from '../dto/provider-detail.dto';
import { ProviderLocationDto } from '../dto/provider-location.dto';
import { ServerTypeDto } from '../dto/server-type.dto';
import { ServiceTypeResponseDto } from '../dto/service-type-response.dto';
import { UpdateServiceTypeDto } from '../dto/update-service-type.dto';
import { ServiceTypeEntity } from '../entities/service-type.entity';
import { ServiceTypesRepository } from '../repositories/service-types.repository';
import { ProviderRegistryService } from '../services/provider-registry.service';
import { ProviderLocationsService } from '../services/provider-locations.service';
import { ProviderServerTypesService } from '../services/provider-server-types.service';
import {
  getProviderEnvDefaultFieldKeys,
  getProviderEnvDefaultFields,
  maskProviderDefaultsForResponse,
  normalizeStoredProviderDefaults,
  sanitizeProviderDefaults,
} from '../utils/provider-env-defaults.utils';

@Controller('service-types')
export class ServiceTypesController {
  constructor(
    private readonly serviceTypesRepository: ServiceTypesRepository,
    private readonly providerRegistry: ProviderRegistryService,
    private readonly providerServerTypesService: ProviderServerTypesService,
    private readonly providerLocationsService: ProviderLocationsService,
  ) {}

  /**
   * Get server types with specs and pricing for a provider (e.g. hetzner).
   * Used by the billing console to show server type dropdown with price and to auto-set base price.
   */
  @Get('providers/:providerId/server-types')
  async getProviderServerTypes(
    @Param('providerId') providerId: string,
    @Query('serviceTypeId', new ParseUUIDPipe({ version: '4', optional: true })) serviceTypeId?: string,
  ): Promise<ServerTypeDto[]> {
    let providerDefaults: Record<string, string> | undefined;

    if (serviceTypeId) {
      const serviceType = await this.serviceTypesRepository.findByIdOrThrow(serviceTypeId);

      if (serviceType.provider !== providerId) {
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
  @Get('providers/:providerId/locations')
  async getProviderLocations(
    @Param('providerId') providerId: string,
    @Query('serviceTypeId', new ParseUUIDPipe({ version: '4', optional: true })) serviceTypeId?: string,
  ): Promise<ProviderLocationDto[]> {
    let providerDefaults: Record<string, string> | undefined;

    if (serviceTypeId) {
      const serviceType = await this.serviceTypesRepository.findByIdOrThrow(serviceTypeId);

      if (serviceType.provider !== providerId) {
        providerDefaults = {};
      } else {
        providerDefaults = normalizeStoredProviderDefaults(serviceType.providerDefaults);
      }
    }

    return this.providerLocationsService.getLocations(providerId, providerDefaults);
  }

  /**
   * Get all registered provider details (id, displayName, configSchema).
   * Used by clients to build provider selectors and validate provider-specific config.
   */
  @Get('providers')
  async getProviders(): Promise<ProviderDetailDto[]> {
    return this.providerRegistry.getProviders();
  }

  @Get()
  async list(
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
  ): Promise<ServiceTypeResponseDto[]> {
    const rows = await this.serviceTypesRepository.findAll(limit ?? 10, offset ?? 0);

    return rows.map((row) => this.mapToResponse(row));
  }

  @Get(':id')
  async get(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string): Promise<ServiceTypeResponseDto> {
    const row = await this.serviceTypesRepository.findByIdOrThrow(id);

    return this.mapToResponse(row);
  }

  @Post()
  @KeycloakRoles(UserRole.ADMIN)
  @UsersRoles(UserRole.ADMIN)
  async create(@Body() dto: CreateServiceTypeDto): Promise<ServiceTypeResponseDto> {
    const providerDefaults = this.resolveProviderDefaultsForPersist(dto.provider, dto.providerDefaults, undefined);
    const row = await this.serviceTypesRepository.create({
      key: dto.key,
      name: dto.name,
      description: dto.description,
      provider: dto.provider,
      configSchema: dto.configSchema ?? {},
      isActive: dto.isActive ?? true,
      disallowStatutoryWithdrawal: dto.disallowStatutoryWithdrawal ?? false,
      providerDefaults,
    });

    return this.mapToResponse(row);
  }

  @Post(':id')
  @KeycloakRoles(UserRole.ADMIN)
  @UsersRoles(UserRole.ADMIN)
  async update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateServiceTypeDto,
  ): Promise<ServiceTypeResponseDto> {
    const existing = await this.serviceTypesRepository.findByIdOrThrow(id);
    const provider = dto.provider ?? existing.provider;
    const providerDefaults = this.resolveProviderDefaultsForPersist(
      provider,
      dto.providerDefaults,
      normalizeStoredProviderDefaults(existing.providerDefaults),
      dto.provider !== undefined && dto.provider !== existing.provider,
    );
    const row = await this.serviceTypesRepository.update(id, {
      name: dto.name,
      description: dto.description,
      provider: dto.provider,
      configSchema: dto.configSchema,
      isActive: dto.isActive,
      disallowStatutoryWithdrawal: dto.disallowStatutoryWithdrawal,
      ...(providerDefaults !== undefined ? { providerDefaults } : {}),
    });

    return this.mapToResponse(row);
  }

  @Delete(':id')
  @KeycloakRoles(UserRole.ADMIN)
  @UsersRoles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    await this.serviceTypesRepository.delete(id);
  }

  private resolveProviderDefaultsForPersist(
    providerId: string,
    input: Record<string, string> | undefined,
    existing: Record<string, string> | undefined,
    providerChanged = false,
  ): Record<string, string> | undefined {
    const allowedKeys = getProviderEnvDefaultFieldKeys(providerId);

    if (input !== undefined) {
      return sanitizeProviderDefaults(input, allowedKeys);
    }

    if (providerChanged && existing) {
      return sanitizeProviderDefaults(existing, allowedKeys);
    }

    return undefined;
  }

  private mapToResponse(row: ServiceTypeEntity): ServiceTypeResponseDto {
    const providerDefaults = normalizeStoredProviderDefaults(row.providerDefaults);
    const { providerDefaultsConfigured } = maskProviderDefaultsForResponse(
      providerDefaults,
      getProviderEnvDefaultFields(row.provider),
    );

    return {
      id: row.id,
      key: row.key,
      name: row.name,
      description: row.description,
      provider: row.provider,
      configSchema: row.configSchema ?? {},
      isActive: row.isActive,
      disallowStatutoryWithdrawal: row.disallowStatutoryWithdrawal,
      providerDefaultsConfigured,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
