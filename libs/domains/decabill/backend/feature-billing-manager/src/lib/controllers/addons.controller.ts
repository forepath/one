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

import { AddonResponseDto } from '../dto/addon-response.dto';
import { CreateAddonDto } from '../dto/create-addon.dto';
import { AttachMeterDto, UpdateAttachedMeterDto } from '../dto/meter.dto';
import { AttachedMeterResponseDto } from '../dto/meter-response.dto';
import { UpdateAddonDto } from '../dto/update-addon.dto';
import { AddonEntity } from '../entities/addon.entity';
import { BillingIntervalType } from '../entities/service-plan.entity';
import { AddonsRepository } from '../repositories/addons.repository';
import { AddonService } from '../services/addon.service';
import { MeterService } from '../services/meter.service';
import { interpolateAddonScriptTemplate, parseAddonConfigFields } from '../utils/addon-config.utils';

@Controller('addons')
@RequireScopes('catalog:write')
export class AddonsController {
  constructor(
    private readonly addonsRepository: AddonsRepository,
    private readonly addonService: AddonService,
    private readonly meterService: MeterService,
  ) {}

  @Get()
  @KeycloakRoles(UserRole.ADMIN)
  @UsersRoles(UserRole.ADMIN)
  async list(
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
  ): Promise<AddonResponseDto[]> {
    const rows = await this.addonsRepository.findAll(limit ?? 10, offset ?? 0);

    return await Promise.all(rows.map((row) => this.mapToResponse(row, false)));
  }

  @Get('modules')
  @KeycloakRoles(UserRole.ADMIN)
  @UsersRoles(UserRole.ADMIN)
  @RequireScopes('catalog:read')
  async listModules(): Promise<
    Array<{
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
    }>
  > {
    return this.addonService.listRegisteredModules();
  }

  @Get(':id/meters')
  @KeycloakRoles(UserRole.ADMIN)
  @UsersRoles(UserRole.ADMIN)
  @RequireScopes('catalog:read')
  async listMeters(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string): Promise<AttachedMeterResponseDto[]> {
    await this.addonsRepository.findByIdOrThrow(id);

    return await this.meterService.listAddonMeters(id);
  }

  @Post(':id/meters')
  @KeycloakRoles(UserRole.ADMIN)
  @UsersRoles(UserRole.ADMIN)
  async attachMeter(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: AttachMeterDto,
  ): Promise<AttachedMeterResponseDto> {
    await this.addonsRepository.findByIdOrThrow(id);

    return await this.meterService.attachAddonMeter(id, dto.meterId, dto.unitPriceNet);
  }

  @Post(':id/meters/:meterId')
  @KeycloakRoles(UserRole.ADMIN)
  @UsersRoles(UserRole.ADMIN)
  async updateMeterAttachment(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('meterId', new ParseUUIDPipe({ version: '4' })) meterId: string,
    @Body() dto: UpdateAttachedMeterDto,
  ): Promise<AttachedMeterResponseDto> {
    await this.addonsRepository.findByIdOrThrow(id);

    return await this.meterService.updateAddonMeter(id, meterId, dto.unitPriceNet);
  }

  @Delete(':id/meters/:meterId')
  @KeycloakRoles(UserRole.ADMIN)
  @UsersRoles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async detachMeter(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('meterId', new ParseUUIDPipe({ version: '4' })) meterId: string,
  ): Promise<void> {
    await this.addonsRepository.findByIdOrThrow(id);
    await this.meterService.detachAddonMeter(id, meterId);
  }

  @Get(':id')
  @KeycloakRoles(UserRole.ADMIN)
  @UsersRoles(UserRole.ADMIN)
  async get(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string): Promise<AddonResponseDto> {
    const row = await this.addonsRepository.findByIdOrThrow(id);

    return await this.mapToResponse(row, true);
  }

  @Post()
  @KeycloakRoles(UserRole.ADMIN)
  @UsersRoles(UserRole.ADMIN)
  async create(@Body() dto: CreateAddonDto): Promise<AddonResponseDto> {
    this.addonService.validateCreatePayload(dto);

    const sanitized = this.addonService.resolveConfigForWrite({
      implementationType: dto.implementationType,
      moduleKey: dto.moduleKey,
      configSchema: dto.configSchema,
      defaultValues: dto.defaultValues,
    });

    const envKeys = sanitized.configSchema.environmentVariables.map((field) => field.key);

    this.assertScriptTemplateInterpolable(dto.implementationType, dto.scriptTemplate, envKeys);
    this.assertScriptTemplateInterpolable(dto.implementationType, dto.deprovisionScriptTemplate, envKeys);

    const row = await this.addonsRepository.create({
      key: dto.key.trim(),
      name: dto.name.trim(),
      description: dto.description?.trim() || undefined,
      implementationType: dto.implementationType,
      moduleKey: dto.implementationType === 'module' ? dto.moduleKey?.trim() || null : null,
      scriptTemplate: dto.implementationType === 'cloud_init_script' ? dto.scriptTemplate?.trim() || null : null,
      deprovisionScriptTemplate:
        dto.implementationType === 'cloud_init_script' ? dto.deprovisionScriptTemplate?.trim() || null : null,
      configSchema: { ...sanitized.configSchema } as Record<string, unknown>,
      configDefaultValues:
        Object.keys(sanitized.configDefaultValues).length > 0 ? sanitized.configDefaultValues : undefined,
      compatibleProviders: (dto.compatibleProviders ?? []).map((p) => p.trim()).filter(Boolean),
      basePrice: dto.basePrice ?? null,
      priceIntervalType: (dto.priceIntervalType as BillingIntervalType) ?? null,
      priceIntervalValue: dto.priceIntervalValue ?? null,
      isActive: dto.isActive ?? true,
    });

    await this.meterService.syncAddonModuleMeters(row);

    return await this.mapToResponse(row, true);
  }

  @Post(':id')
  @KeycloakRoles(UserRole.ADMIN)
  @UsersRoles(UserRole.ADMIN)
  async update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateAddonDto,
  ): Promise<AddonResponseDto> {
    const existing = await this.addonsRepository.findByIdOrThrow(id);
    const validated = this.addonService.validateUpdatePayload(existing, dto);
    const updatePayload: Partial<AddonEntity> = {};

    if (dto.name !== undefined) {
      updatePayload.name = dto.name.trim();
    }

    if (dto.description !== undefined) {
      updatePayload.description = dto.description.trim() || undefined;
    }

    updatePayload.implementationType = validated.implementationType;
    updatePayload.moduleKey = validated.implementationType === 'module' ? validated.moduleKey?.trim() || null : null;
    updatePayload.scriptTemplate =
      validated.implementationType === 'cloud_init_script' ? validated.scriptTemplate?.trim() || null : null;

    const mergedDeprovisionScriptTemplate =
      dto.deprovisionScriptTemplate !== undefined ? dto.deprovisionScriptTemplate : existing.deprovisionScriptTemplate;

    updatePayload.deprovisionScriptTemplate =
      validated.implementationType === 'cloud_init_script' ? mergedDeprovisionScriptTemplate?.trim() || null : null;

    if (
      dto.configSchema !== undefined ||
      dto.defaultValues !== undefined ||
      dto.implementationType !== undefined ||
      dto.moduleKey !== undefined
    ) {
      const sanitized = this.addonService.resolveConfigForWrite({
        implementationType: validated.implementationType,
        moduleKey: validated.moduleKey,
        configSchema: dto.configSchema,
        defaultValues: dto.defaultValues,
        existing,
      });

      updatePayload.configSchema = { ...sanitized.configSchema } as Record<string, unknown>;
      updatePayload.configDefaultValues =
        Object.keys(sanitized.configDefaultValues).length > 0 ? sanitized.configDefaultValues : undefined;
    }

    const scriptTemplate =
      updatePayload.scriptTemplate !== undefined ? updatePayload.scriptTemplate : existing.scriptTemplate;
    const schemaForScript =
      (updatePayload.configSchema as Record<string, unknown> | undefined) ?? existing.configSchema;
    const envKeys = parseAddonConfigFields(schemaForScript).map((field) => field.key);

    this.assertScriptTemplateInterpolable(validated.implementationType, scriptTemplate ?? undefined, envKeys);
    this.assertScriptTemplateInterpolable(
      validated.implementationType,
      updatePayload.deprovisionScriptTemplate ?? undefined,
      envKeys,
    );

    if (dto.compatibleProviders !== undefined) {
      updatePayload.compatibleProviders = dto.compatibleProviders.map((p) => p.trim()).filter(Boolean);
    }

    if (dto.basePrice !== undefined) {
      updatePayload.basePrice = dto.basePrice;
    }

    if (dto.priceIntervalType !== undefined) {
      updatePayload.priceIntervalType = (dto.priceIntervalType as BillingIntervalType) ?? null;
    }

    if (dto.priceIntervalValue !== undefined) {
      updatePayload.priceIntervalValue = dto.priceIntervalValue;
    }

    if (dto.isActive !== undefined) {
      if (dto.isActive === false && existing.isActive) {
        await this.addonService.assertNotReferencedByActivePlans(id);
      }

      updatePayload.isActive = dto.isActive;
    }

    const row = await this.addonsRepository.update(id, updatePayload);

    await this.meterService.syncAddonModuleMeters(row);

    return await this.mapToResponse(row, true);
  }

  @Delete(':id')
  @KeycloakRoles(UserRole.ADMIN)
  @UsersRoles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string): Promise<void> {
    await this.addonService.assertCanDelete(id);
    await this.addonsRepository.delete(id);
  }

  private assertScriptTemplateInterpolable(
    implementationType: string,
    scriptTemplate: string | null | undefined,
    envKeys: string[],
  ): void {
    if (implementationType !== 'cloud_init_script' || !scriptTemplate?.trim()) {
      return;
    }

    const sampleEnv = Object.fromEntries(envKeys.map((key) => [key, 'sample-value']));

    try {
      interpolateAddonScriptTemplate(scriptTemplate.trim(), sampleEnv, envKeys);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid addon script template';

      throw new BadRequestException(message);
    }
  }

  private async mapToResponse(row: AddonEntity, includeDefaults: boolean): Promise<AddonResponseDto> {
    return {
      id: row.id,
      key: row.key,
      name: row.name,
      description: row.description ?? null,
      implementationType: row.implementationType,
      moduleKey: row.moduleKey ?? null,
      scriptTemplate: row.scriptTemplate ?? null,
      deprovisionScriptTemplate: row.deprovisionScriptTemplate ?? null,
      configSchema: row.configSchema ?? {},
      ...(includeDefaults && row.configDefaultValues ? { defaultValues: { ...row.configDefaultValues } } : {}),
      compatibleProviders: row.compatibleProviders ?? [],
      basePrice: row.basePrice ?? null,
      priceIntervalType: row.priceIntervalType ?? null,
      priceIntervalValue: row.priceIntervalValue ?? null,
      meters: await this.meterService.listAddonMeters(row.id),
      isActive: row.isActive,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
