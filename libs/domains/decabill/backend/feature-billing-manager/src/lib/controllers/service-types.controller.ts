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
import { ServerTypeDto } from '../dto/server-type.dto';
import { ServiceTypeResponseDto } from '../dto/service-type-response.dto';
import { UpdateServiceTypeDto } from '../dto/update-service-type.dto';
import { ServiceTypeEntity } from '../entities/service-type.entity';
import { ServiceTypesRepository } from '../repositories/service-types.repository';
import { ProviderRegistryService } from '../services/provider-registry.service';
import { ProviderServerTypesService } from '../services/provider-server-types.service';

@Controller('service-types')
export class ServiceTypesController {
  constructor(
    private readonly serviceTypesRepository: ServiceTypesRepository,
    private readonly providerRegistry: ProviderRegistryService,
    private readonly providerServerTypesService: ProviderServerTypesService,
  ) {}

  /**
   * Get server types with specs and pricing for a provider (e.g. hetzner).
   * Used by the billing console to show server type dropdown with price and to auto-set base price.
   */
  @Get('providers/:providerId/server-types')
  async getProviderServerTypes(@Param('providerId') providerId: string): Promise<ServerTypeDto[]> {
    return this.providerServerTypesService.getServerTypes(providerId);
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
    const row = await this.serviceTypesRepository.create({
      key: dto.key,
      name: dto.name,
      description: dto.description,
      provider: dto.provider,
      configSchema: dto.configSchema ?? {},
      isActive: dto.isActive ?? true,
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
    const row = await this.serviceTypesRepository.update(id, {
      name: dto.name,
      description: dto.description,
      provider: dto.provider,
      configSchema: dto.configSchema,
      isActive: dto.isActive,
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

  private mapToResponse(row: ServiceTypeEntity): ServiceTypeResponseDto {
    return {
      id: row.id,
      key: row.key,
      name: row.name,
      description: row.description,
      provider: row.provider,
      configSchema: row.configSchema ?? {},
      isActive: row.isActive,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
