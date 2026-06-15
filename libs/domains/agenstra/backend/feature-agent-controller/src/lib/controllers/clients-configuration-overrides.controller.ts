import {
  UpsertWorkspaceConfigurationOverrideDto,
  WorkspaceConfigurationSettingResponseDto,
} from '@forepath/agenstra/backend/feature-agent-manager';
import {
  ClientUsersRepository,
  ensureWorkspaceManagementAccess,
  type RequestWithUser,
} from '@forepath/identity/backend';
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Put, Req } from '@nestjs/common';

import { ClientsRepository } from '../repositories/clients.repository';
import { ClientWorkspaceConfigurationOverridesProxyService } from '../services/client-workspace-configuration-overrides-proxy.service';

@Controller('clients/:id/configuration-overrides')
export class ClientsConfigurationOverridesController {
  constructor(
    private readonly proxyService: ClientWorkspaceConfigurationOverridesProxyService,
    private readonly clientsRepository: ClientsRepository,
    private readonly clientUsersRepository: ClientUsersRepository,
  ) {}

  @Get()
  async getConfigurationOverrides(
    @Param('id', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Req() req?: RequestWithUser,
  ): Promise<WorkspaceConfigurationSettingResponseDto[]> {
    await ensureWorkspaceManagementAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);

    return await this.proxyService.getConfigurationOverrides(clientId);
  }

  @Put(':settingKey')
  async upsertConfigurationOverride(
    @Param('id', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('settingKey') settingKey: string,
    @Body() dto: UpsertWorkspaceConfigurationOverrideDto,
    @Req() req?: RequestWithUser,
  ): Promise<WorkspaceConfigurationSettingResponseDto> {
    await ensureWorkspaceManagementAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);

    return await this.proxyService.upsertConfigurationOverride(clientId, settingKey, dto);
  }

  @Delete(':settingKey')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteConfigurationOverride(
    @Param('id', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('settingKey') settingKey: string,
    @Req() req?: RequestWithUser,
  ): Promise<void> {
    await ensureWorkspaceManagementAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);
    await this.proxyService.deleteConfigurationOverride(clientId, settingKey);
  }
}
