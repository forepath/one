import {
  ClientUsersRepository,
  RequireScopes,
  ensureWorkspaceManagementAccess,
  type RequestWithUser,
} from '@forepath/identity/backend';
import {
  assertNoV1RootKeys,
  assertOverlayRespectsHeredity,
  assertSecretsRespectLocks,
  OpencodeConfigValidationError,
} from '@forepath/agenstra/shared/util-opencode-config';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';

import {
  OpencodeConfigResponseDto,
  UpsertOpencodeConfigDto,
  OpencodeAgentsListResponseDto,
  OpencodeCommandsListResponseDto,
  OpencodeMcpAuthCallbackDto,
  OpencodeMcpAuthStartResponseDto,
  OpencodeMcpServerStatusDto,
  OpencodeMcpStatusListResponseDto,
} from '../dto/opencode-config.dto';
import { ClientsRepository } from '../repositories/clients.repository';
import { ClientAgentOpencodeConfigProxyService } from '../services/client-agent-opencode-config-proxy.service';
import { OpencodeConfigService } from '../services/opencode-config.service';
import { OpencodeConfigSyncTargetsService } from '../services/opencode-config-sync-targets.service';
import { assertNoCredentialKeysInConfig } from '../utils/opencode-config-credentials.utils';
import {
  buildMcpOAuthCallbackUrl,
  readMcpOAuthCallbackSecret,
  resolveMcpOAuthPublicBaseUrl,
} from '../utils/mcp-oauth-callback.util';

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

  @Get('opencode/config')
  @RequireScopes('clients:read')
  async getWorkspace(
    @Param('id', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Req() req?: RequestWithUser,
  ): Promise<OpencodeConfigResponseDto> {
    await ensureWorkspaceManagementAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);

    return await this.opencodeConfigService.getClient(clientId);
  }

  @Put('opencode/config')
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

  @Get('agents/:agentId/opencode/config')
  @RequireScopes('clients:read')
  async getAgent(
    @Param('id', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Req() req?: RequestWithUser,
  ): Promise<OpencodeConfigResponseDto> {
    await ensureWorkspaceManagementAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);
    const agentConfig = await this.agentProxy.get(clientId, agentId);
    const layers = await this.opencodeConfigService.getLayerParents(clientId);
    const heredity = this.opencodeConfigService.computeHeredity(layers.global, layers.workspace);
    const agentOverlay = this.opencodeConfigService.composeStoredLayer(agentConfig.config, agentConfig.overrides);
    const effective = this.opencodeConfigService.mergeEffective(
      agentOverlay,
      layers.workspace.overlay,
      layers.global.overlay,
    );
    const sync = await this.configSyncTargets.getSummaryForAgent(agentId);

    return {
      ...agentConfig,
      config: agentConfig.config ?? {},
      overrides: agentConfig.overrides ?? {},
      locks: [],
      effective,
      lockedPaths: heredity.lockedPaths,
      inheritedAdditive: heredity.inheritedAdditive,
      sync,
    };
  }

  @Put('agents/:agentId/opencode/config')
  @RequireScopes('clients:write')
  async putAgent(
    @Param('id', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Body() dto: UpsertOpencodeConfigDto,
    @Req() req?: RequestWithUser,
  ): Promise<OpencodeConfigResponseDto> {
    await ensureWorkspaceManagementAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);

    if (dto.locks !== undefined && dto.locks !== null && dto.locks.length > 0) {
      throw new BadRequestException('Explicit locks are not supported on the Environment layer');
    }

    assertNoCredentialKeysInConfig(dto.config ?? undefined);
    assertNoCredentialKeysInConfig(dto.overrides ?? undefined);

    const layers = await this.opencodeConfigService.getLayerParents(clientId);
    const heredity = this.opencodeConfigService.computeHeredity(layers.global, layers.workspace);
    const existing = await this.agentProxy.get(clientId, agentId);
    const sanitized = await this.opencodeConfigService.sanitizeUpsertAgainstAllowDeny(dto, {
      parentOverlaysLowToHigh: [layers.workspace.overlay ?? {}, layers.global.overlay ?? {}],
      inheritedAdditive: heredity.inheritedAdditive,
      existingConfig: existing.config,
      existingOverrides: existing.overrides,
    });

    try {
      assertNoV1RootKeys(sanitized.config ?? undefined);
      assertNoV1RootKeys(sanitized.overrides ?? undefined);
      assertOverlayRespectsHeredity(sanitized.config ?? undefined, heredity.lockedPaths, heredity.inheritedAdditive);
      assertOverlayRespectsHeredity(sanitized.overrides ?? undefined, heredity.lockedPaths, heredity.inheritedAdditive);
      assertSecretsRespectLocks(sanitized.secrets ?? undefined, heredity.lockedPaths);
    } catch (error) {
      if (error instanceof OpencodeConfigValidationError) {
        throw new BadRequestException(error.message);
      }

      throw error;
    }

    const agentPayload = { ...sanitized, locks: undefined };
    const agentConfig = await this.agentProxy.put(clientId, agentId, agentPayload);
    const agentOverlay = this.opencodeConfigService.composeStoredLayer(agentConfig.config, agentConfig.overrides);
    const effective = this.opencodeConfigService.mergeEffective(
      agentOverlay,
      layers.workspace.overlay,
      layers.global.overlay,
    );
    const sync = await this.configSyncTargets.markAndProcessAgent(clientId, agentId);

    return {
      ...agentConfig,
      overrides: agentConfig.overrides ?? {},
      locks: [],
      effective,
      lockedPaths: heredity.lockedPaths,
      inheritedAdditive: heredity.inheritedAdditive,
      sync,
    };
  }

  @Get('agents/:agentId/opencode/config/agents')
  @RequireScopes('clients:read')
  async listAgentAgents(
    @Param('id', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Req() req?: RequestWithUser,
  ): Promise<OpencodeAgentsListResponseDto> {
    await ensureWorkspaceManagementAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);

    return await this.agentProxy.listAgents(clientId, agentId);
  }

  @Get('agents/:agentId/opencode/config/commands')
  @RequireScopes('clients:read')
  async listAgentCommands(
    @Param('id', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Req() req?: RequestWithUser,
  ): Promise<OpencodeCommandsListResponseDto> {
    await ensureWorkspaceManagementAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);

    return await this.agentProxy.listCommands(clientId, agentId);
  }

  @Get('agents/:agentId/opencode/mcp')
  @RequireScopes('clients:read')
  async listAgentMcpStatuses(
    @Param('id', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Req() req?: RequestWithUser,
  ): Promise<OpencodeMcpStatusListResponseDto> {
    await ensureWorkspaceManagementAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);

    return await this.agentProxy.listMcpStatuses(clientId, agentId);
  }

  @Post('agents/:agentId/opencode/mcp/:name/auth')
  @RequireScopes('clients:write')
  async startAgentMcpAuth(
    @Param('id', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('name') name: string,
    @Req() req: Request & RequestWithUser,
  ): Promise<OpencodeMcpAuthStartResponseDto> {
    await ensureWorkspaceManagementAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);

    let publicBaseUrl: string;
    let secret: string;

    try {
      const forwardedProto = req.headers['x-forwarded-proto'];
      const forwardedHost = req.headers['x-forwarded-host'];
      const protocol =
        (typeof forwardedProto === 'string' ? forwardedProto.split(',')[0]?.trim() : undefined) ||
        (req.protocol === 'https' ? 'https' : 'http');
      const host =
        (typeof forwardedHost === 'string' ? forwardedHost.split(',')[0]?.trim() : undefined) || req.headers.host;

      publicBaseUrl = resolveMcpOAuthPublicBaseUrl(process.env, { protocol, host });
      secret = readMcpOAuthCallbackSecret();
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'MCP OAuth callback is not configured');
    }

    const redirectUri = buildMcpOAuthCallbackUrl({
      publicBaseUrl,
      clientId,
      agentId,
      name,
      secret,
    });

    return await this.agentProxy.startMcpAuth(clientId, agentId, name, redirectUri);
  }

  @Post('agents/:agentId/opencode/mcp/:name/auth/callback')
  @RequireScopes('clients:write')
  async completeAgentMcpAuth(
    @Param('id', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('name') name: string,
    @Body() dto: OpencodeMcpAuthCallbackDto,
    @Req() req?: RequestWithUser,
  ): Promise<OpencodeMcpServerStatusDto> {
    await ensureWorkspaceManagementAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);

    return await this.agentProxy.completeMcpAuth(clientId, agentId, name, dto.code);
  }

  @Delete('agents/:agentId/opencode/mcp/:name/auth')
  @RequireScopes('clients:write')
  async removeAgentMcpAuth(
    @Param('id', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('name') name: string,
    @Req() req?: RequestWithUser,
  ): Promise<{ success: true }> {
    await ensureWorkspaceManagementAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);

    return await this.agentProxy.removeMcpAuth(clientId, agentId, name);
  }
}
