import { KeycloakRoles, RequireScopes, UserRole, UsersRoles } from '@forepath/identity/backend';
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

import { CreateCloudInitConfigDto } from '../dto/create-cloud-init-config.dto';
import { CloudInitConfigResponseDto } from '../dto/cloud-init-config-response.dto';
import { UpdateCloudInitConfigDto } from '../dto/update-cloud-init-config.dto';
import { CloudInitConfigEntity } from '../entities/cloud-init-config.entity';
import { CloudInitConfigsRepository } from '../repositories/cloud-init-configs.repository';
import { CloudInitConfigService } from '../services/cloud-init-config.service';

@Controller('cloud-init-configs')
@RequireScopes('catalog:write')
export class CloudInitConfigsController {
  constructor(
    private readonly cloudInitConfigsRepository: CloudInitConfigsRepository,
    private readonly cloudInitConfigService: CloudInitConfigService,
  ) {}

  @Get()
  @KeycloakRoles(UserRole.ADMIN)
  @UsersRoles(UserRole.ADMIN)
  async list(
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
  ): Promise<CloudInitConfigResponseDto[]> {
    const rows = await this.cloudInitConfigsRepository.findAll(limit ?? 10, offset ?? 0);

    return rows.map((row) => this.mapToResponse(row, false));
  }

  @Get(':id')
  @KeycloakRoles(UserRole.ADMIN)
  @UsersRoles(UserRole.ADMIN)
  async get(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string): Promise<CloudInitConfigResponseDto> {
    const row = await this.cloudInitConfigsRepository.findByIdOrThrow(id);

    return this.mapToResponse(row, true);
  }

  @Post()
  @KeycloakRoles(UserRole.ADMIN)
  @UsersRoles(UserRole.ADMIN)
  async create(@Body() dto: CreateCloudInitConfigDto): Promise<CloudInitConfigResponseDto> {
    const { environmentVariables, envDefaultValues } = this.cloudInitConfigService.sanitizeEnvironmentVariables(
      dto.environmentVariables?.map((v) => ({
        key: v.key,
        label: v.label,
        description: v.description,
        showInOrderForm: v.showInOrderForm,
        hasDefault: false,
        useRandomDefault: v.useRandomDefault,
        randomDefaultLength: v.randomDefaultLength,
        randomDefaultSpecialChars: v.randomDefaultSpecialChars,
      })),
      dto.defaultValues,
    );

    const provisioningMode = dto.provisioningMode ?? 'simple';

    this.cloudInitConfigService.validateProvisioningPayload({
      provisioningMode,
      dockerImage: dto.dockerImage,
      containerPort: dto.containerPort,
      hostPort: dto.hostPort,
      workDir: dto.workDir,
      dockerComposeTemplate: dto.dockerComposeTemplate,
      userDataTemplate: dto.userDataTemplate,
      environmentVariables,
    });

    const row = await this.cloudInitConfigsRepository.create({
      key: dto.key.trim(),
      name: dto.name.trim(),
      provisioningMode,
      description: dto.description?.trim() || undefined,
      dockerImage: dto.dockerImage?.trim() || null,
      containerPort: dto.containerPort ?? 8080,
      hostPort: dto.hostPort ?? 80,
      workDir: dto.workDir?.trim() || '/opt/custom-app',
      dockerComposeTemplate: dto.dockerComposeTemplate?.trim() || null,
      userDataTemplate: dto.userDataTemplate?.trim() || null,
      environmentVariables,
      envDefaultValues,
      isActive: dto.isActive ?? true,
    });

    return this.mapToResponse(row, true);
  }

  @Post(':id')
  @KeycloakRoles(UserRole.ADMIN)
  @UsersRoles(UserRole.ADMIN)
  async update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateCloudInitConfigDto,
  ): Promise<CloudInitConfigResponseDto> {
    const existing = await this.cloudInitConfigsRepository.findByIdOrThrow(id);
    const updatePayload: Partial<CloudInitConfigEntity> = {};

    if (dto.name !== undefined) {
      updatePayload.name = dto.name.trim();
    }

    if (dto.description !== undefined) {
      updatePayload.description = dto.description.trim() || undefined;
    }

    if (dto.provisioningMode !== undefined) {
      updatePayload.provisioningMode = dto.provisioningMode;
    }

    if (dto.dockerImage !== undefined) {
      updatePayload.dockerImage = dto.dockerImage.trim() || null;
    }

    if (dto.containerPort !== undefined) {
      updatePayload.containerPort = dto.containerPort;
    }

    if (dto.hostPort !== undefined) {
      updatePayload.hostPort = dto.hostPort;
    }

    if (dto.workDir !== undefined) {
      updatePayload.workDir = dto.workDir.trim() || '/opt/custom-app';
    }

    if (dto.dockerComposeTemplate !== undefined) {
      updatePayload.dockerComposeTemplate = dto.dockerComposeTemplate?.trim() || null;
    }

    if (dto.userDataTemplate !== undefined) {
      updatePayload.userDataTemplate = dto.userDataTemplate?.trim() || null;
    }

    if (dto.isActive !== undefined) {
      if (dto.isActive === false && existing.isActive) {
        await this.cloudInitConfigService.assertNotReferencedByActivePlans(id);
      }

      updatePayload.isActive = dto.isActive;
    }

    if (dto.environmentVariables !== undefined || dto.defaultValues !== undefined) {
      const mergedDefaults = dto.defaultValues !== undefined ? dto.defaultValues : (existing.envDefaultValues ?? {});

      const { environmentVariables, envDefaultValues } = this.cloudInitConfigService.sanitizeEnvironmentVariables(
        (dto.environmentVariables ?? existing.environmentVariables)?.map((v) => ({
          key: v.key,
          label: v.label,
          description: v.description,
          showInOrderForm: v.showInOrderForm,
          hasDefault: false,
          useRandomDefault: v.useRandomDefault,
          randomDefaultLength: v.randomDefaultLength,
          randomDefaultSpecialChars: v.randomDefaultSpecialChars,
        })),
        mergedDefaults,
      );

      updatePayload.environmentVariables = environmentVariables;
      updatePayload.envDefaultValues = envDefaultValues;
    }

    const mergedForValidation: CloudInitConfigEntity = {
      ...existing,
      ...updatePayload,
      environmentVariables: updatePayload.environmentVariables ?? existing.environmentVariables ?? [],
    };

    this.cloudInitConfigService.validateProvisioningPayload({
      provisioningMode: mergedForValidation.provisioningMode ?? 'simple',
      dockerImage: mergedForValidation.dockerImage,
      containerPort: mergedForValidation.containerPort,
      hostPort: mergedForValidation.hostPort,
      workDir: mergedForValidation.workDir,
      dockerComposeTemplate: mergedForValidation.dockerComposeTemplate,
      userDataTemplate: mergedForValidation.userDataTemplate,
      environmentVariables: mergedForValidation.environmentVariables ?? [],
    });

    const row = await this.cloudInitConfigsRepository.update(id, updatePayload);

    return this.mapToResponse(row, true);
  }

  @Delete(':id')
  @KeycloakRoles(UserRole.ADMIN)
  @UsersRoles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string): Promise<void> {
    await this.cloudInitConfigService.assertNotReferencedByActivePlans(id);
    await this.cloudInitConfigsRepository.delete(id);
  }

  private mapToResponse(row: CloudInitConfigEntity, includeDefaults: boolean): CloudInitConfigResponseDto {
    return {
      id: row.id,
      key: row.key,
      name: row.name,
      provisioningMode: row.provisioningMode ?? 'simple',
      description: row.description ?? null,
      dockerImage: row.dockerImage ?? null,
      containerPort: row.containerPort,
      hostPort: row.hostPort,
      workDir: row.workDir,
      dockerComposeTemplate: row.dockerComposeTemplate ?? null,
      userDataTemplate: row.userDataTemplate ?? null,
      environmentVariables: row.environmentVariables ?? [],
      ...(includeDefaults && row.envDefaultValues ? { defaultValues: { ...row.envDefaultValues } } : {}),
      isActive: row.isActive,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
