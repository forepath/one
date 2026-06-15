import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Put } from '@nestjs/common';

import { UpsertWorkspaceConfigurationOverrideDto } from '../dto/upsert-workspace-configuration-override.dto';
import { WorkspaceConfigurationSettingResponseDto } from '../dto/workspace-configuration-setting-response.dto';
import { WorkspaceConfigurationOverridesService } from '../services/workspace-configuration-overrides.service';

@Controller('configuration-overrides')
export class WorkspaceConfigurationOverridesController {
  constructor(private readonly service: WorkspaceConfigurationOverridesService) {}

  @Get()
  async getConfigurationOverrides(): Promise<WorkspaceConfigurationSettingResponseDto[]> {
    return await this.service.getEffectiveSettings();
  }

  @Put(':settingKey')
  async upsertConfigurationOverride(
    @Param('settingKey') settingKey: string,
    @Body() dto: UpsertWorkspaceConfigurationOverrideDto,
  ): Promise<WorkspaceConfigurationSettingResponseDto> {
    return await this.service.upsertOverride(settingKey, dto.value);
  }

  @Delete(':settingKey')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteConfigurationOverride(@Param('settingKey') settingKey: string): Promise<void> {
    await this.service.deleteOverride(settingKey);
  }
}
