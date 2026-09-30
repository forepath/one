import {
  ClientUsersRepository,
  RequireScopes,
  ensureWorkspaceManagementAccess,
  type RequestWithUser,
} from '@forepath/identity/backend';
import {
  assertNoV1RootKeys,
  assertOverlayRespectsHeredity,
  OpencodeConfigValidationError,
} from '@forepath/agenstra/shared/util-opencode-config';
import { BadRequestException, Body, Controller, Get, Logger, Param, ParseUUIDPipe, Put, Req } from '@nestjs/common';

import {
  OpencodeConfigResponseDto,
  UpsertOpencodeConfigDto,
  OpencodeAgentsListResponseDto,
  OpencodeCommandsListResponseDto,
} from '../dto/opencode-config.dto';
import { ClientsRepository } from '../repositories/clients.repository';
import { ClientAgentOpencodeConfigProxyService } from '../services/client-agent-opencode-config-proxy.service';
import { OpencodeConfigService } from '../services/opencode-config.service';
import { OpencodeConfigSyncTargetsService } from '../services/opencode-config-sync-targets.service';
import { assertNoCredentialKeysInConfig } from '../utils/opencode-config-credentials.utils';

@Controller('clients/:id')
export class ClientOpencodeConfigController {
  private readonly logger = new Logger(ClientOpencodeConfigController.name);

  constructor(
    private readonly opencodeConfigService: OpencodeConfigService,
    private readonly agentProxy: ClientAgentOpencodeConfigProxyService,
    private readonly configSyncTargets: OpencodeConfigSyncTargetsService,
    private readonly clientsRepository: ClientsRepository,
    private readonly clientUsersRepository: ClientUsersRepository,
  ) {}

  @Get('opencode-config')
  @RequireScopes('clients:read')
  async getWorkspace(
    @Param('id', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Req() req?: RequestWithUser,
  ): Promise<OpencodeConfigResponseDto> {
    await ensureWorkspaceManagementAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);

    return await this.opencodeConfigService.getClient(clientId);
  }

  @Put('opencode-config')
  @RequireScopes('clients:write')
  async putWorkspace(
    @Param('id', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Body() dto: UpsertOpencodeConfigDto,
    @Req() req?: RequestWithUser,
  ): Promise<OpencodeConfigResponseDto> {
    await ensureWorkspaceManagementAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);

    const response = await this.opencodeConfigService.putClient(clientId, dto);

    void this.configSyncTargets.markAndProcessClient(clientId).catch((error: unknown) => {
      const err = error as { message?: string };

      this.logger.warn(`Cascade OpenCode config sync failed for client ${clientId}: ${err.message ?? 'unknown'}`);
    });

    return response;
  }

  @Get('agents/:agentId/opencode-config')
  @RequireScopes('clients:read')
  async getAgent(
    @Param('id', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Req() req?: RequestWithUser,
  ): Promise<OpencodeConfigResponseDto> {
    await ensureWorkspaceManagementAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);
    const agentConfig = await this.agentProxy.get(clientId, agentId);
    const layers = await this.opencodeConfigService.getLayerConfigs(clientId);
    const heredity = this.opencodeConfigService.computeHeredity(layers.global, layers.workspace);
    const agentOverlay = this.opencodeConfigService.composeStoredLayer(agentConfig.config, agentConfig.overrides);
    const effective = this.opencodeConfigService.mergeEffective(agentOverlay, layers.workspace, layers.global);
    const sync = await this.configSyncTargets.getSummaryForAgent(agentId);

    return {
      ...agentConfig,
      config: agentConfig.config ?? {},
      overrides: agentConfig.overrides ?? {},
      effective,
      lockedPaths: heredity.lockedPaths,
      inheritedAdditive: heredity.inheritedAdditive,
      sync,
    };
  }

  @Put('agents/:agentId/opencode-config')
  @RequireScopes('clients:write')
  async putAgent(
    @Param('id', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Body() dto: UpsertOpencodeConfigDto,
    @Req() req?: RequestWithUser,
  ): Promise<OpencodeConfigResponseDto> {
    await ensureWorkspaceManagementAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);
    assertNoCredentialKeysInConfig(dto.config ?? undefined);
    assertNoCredentialKeysInConfig(dto.overrides ?? undefined);

    const layers = await this.opencodeConfigService.getLayerConfigs(clientId);
    const heredity = this.opencodeConfigService.computeHeredity(layers.global, layers.workspace);

    try {
      assertNoV1RootKeys(dto.config ?? undefined);
      assertNoV1RootKeys(dto.overrides ?? undefined);
      assertOverlayRespectsHeredity(dto.config ?? undefined, heredity.lockedPaths, heredity.inheritedAdditive);
      assertOverlayRespectsHeredity(dto.overrides ?? undefined, heredity.lockedPaths, heredity.inheritedAdditive);
    } catch (error) {
      if (error instanceof OpencodeConfigValidationError) {
        throw new BadRequestException(error.message);
      }

      throw error;
    }

    const agentConfig = await this.agentProxy.put(clientId, agentId, dto);
    const agentOverlay = this.opencodeConfigService.composeStoredLayer(agentConfig.config, agentConfig.overrides);
    const effective = this.opencodeConfigService.mergeEffective(agentOverlay, layers.workspace, layers.global);
    const sync = await this.configSyncTargets.markAndProcessAgent(clientId, agentId);

    return {
      ...agentConfig,
      overrides: agentConfig.overrides ?? {},
      effective,
      lockedPaths: heredity.lockedPaths,
      inheritedAdditive: heredity.inheritedAdditive,
      sync,
    };
  }

  @Get('agents/:agentId/opencode-config/agents')
  @RequireScopes('clients:read')
  async listAgentAgents(
    @Param('id', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Req() req?: RequestWithUser,
  ): Promise<OpencodeAgentsListResponseDto> {
    await ensureWorkspaceManagementAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);

    return await this.agentProxy.listAgents(clientId, agentId);
  }

  @Get('agents/:agentId/opencode-config/commands')
  @RequireScopes('clients:read')
  async listAgentCommands(
    @Param('id', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Req() req?: RequestWithUser,
  ): Promise<OpencodeCommandsListResponseDto> {
    await ensureWorkspaceManagementAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);

    return await this.agentProxy.listCommands(clientId, agentId);
  }
}
