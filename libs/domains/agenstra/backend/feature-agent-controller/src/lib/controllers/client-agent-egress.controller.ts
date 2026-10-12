import type { AgentEgressDetailsDto } from '@forepath/agenstra/backend/feature-agent-manager';
import {
  ClientUsersRepository,
  RequireScopes,
  ensureWorkspaceManagementAccess,
  type RequestWithUser,
} from '@forepath/identity/backend';
import { evaluateEgressDestination } from '@forepath/agenstra/shared/util-opencode-config';
import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';

import { EgressEvaluationResponseDto, EvaluateEgressDestinationDto } from '../dto/opencode-config.dto';
import { ClientsRepository } from '../repositories/clients.repository';
import { ClientAgentOpencodeConfigProxyService } from '../services/client-agent-opencode-config-proxy.service';
import { ClientAgentProxyService } from '../services/client-agent-proxy.service';
import { OpencodeConfigService } from '../services/opencode-config.service';

/** Split a destination (host, host:port, or URL) into host and scheme. */
export function parseEgressDestination(raw: string): { host: string; scheme: 'http' | 'https' | null; url?: string } {
  const value = raw.trim();

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    let parsed: URL;

    try {
      parsed = new URL(value);
    } catch {
      throw new BadRequestException('destination is not a valid URL');
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new BadRequestException('Only http:// and https:// URLs can be evaluated');
    }

    return {
      host: parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase(),
      scheme: parsed.protocol === 'http:' ? 'http' : 'https',
      url: `${parsed.protocol}//${parsed.host}${parsed.pathname}`,
    };
  }

  const withoutPath = value.split('/')[0] ?? '';
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(withoutPath);
  const host = bracketed
    ? bracketed[1]
    : (withoutPath.match(/:/g) ?? []).length === 1
      ? withoutPath.slice(0, withoutPath.indexOf(':'))
      : withoutPath;

  if (!host) {
    throw new BadRequestException('destination must contain a hostname or IP address');
  }

  return { host: host.toLowerCase(), scheme: null };
}

/**
 * Egress guard (web traffic filtering) status and policy evaluation for agent environments.
 * Exposes layered policy details (hosts, message filter patterns), so access matches the agent
 * configuration endpoints: `clients:read` plus workspace management access.
 */
@Controller('clients/:id/agents/:agentId/egress')
export class ClientAgentEgressController {
  constructor(
    private readonly clientAgentProxy: ClientAgentProxyService,
    private readonly agentConfigProxy: ClientAgentOpencodeConfigProxyService,
    private readonly opencodeConfigService: OpencodeConfigService,
    private readonly clientsRepository: ClientsRepository,
    private readonly clientUsersRepository: ClientUsersRepository,
  ) {}

  /** Guard status, policy in force on the manager, message filters and recent decisions. */
  @Get()
  @RequireScopes('clients:read')
  async getEgress(
    @Param('id', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Req() req?: RequestWithUser,
  ): Promise<AgentEgressDetailsDto> {
    await ensureWorkspaceManagementAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);

    return await this.clientAgentProxy.getClientAgentEgress(clientId, agentId);
  }

  /** Evaluate a destination against the environment's effective (layered) egress policy. */
  @Post('evaluate')
  @HttpCode(200)
  @RequireScopes('clients:read')
  async evaluate(
    @Param('id', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Body() dto: EvaluateEgressDestinationDto,
    @Req() req?: RequestWithUser,
  ): Promise<EgressEvaluationResponseDto> {
    await ensureWorkspaceManagementAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);

    const destination = parseEgressDestination(dto.destination);
    const layers = await this.opencodeConfigService.getLayerConfigs(clientId);
    const agentConfig = await this.agentConfigProxy.get(clientId, agentId);
    const policy = this.opencodeConfigService.resolvePlatformPolicy({
      global: layers.global,
      workspace: layers.workspace,
      environment: this.opencodeConfigService.composeStoredLayer(agentConfig.config, agentConfig.overrides),
    }).egress;
    const result = evaluateEgressDestination(policy, destination.host, {
      url: destination.url,
      scheme: destination.scheme ?? undefined,
    });

    return {
      host: destination.host,
      decision: result.decision,
      rule: result.rule,
      matchedEntry: result.matchedEntry ?? null,
      source: result.source ?? null,
      mode: policy.mode,
      scheme: destination.scheme,
    };
  }
}
