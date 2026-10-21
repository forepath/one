import {
  AGENSTRA_CONTEXT_API_HEADERS,
  AGENSTRA_CONTEXT_API_ROUTE,
  AGENSTRA_HANDOFFS_API_SEGMENT,
  type AgentHandoffAgentSummary,
  type AgentHandoffAgentsResponse,
  type AgentHandoffResponse,
  type AgentHandoffSelfSummary,
} from '@forepath/agenstra/shared/util-opencode-config';
import { Public } from '@forepath/identity/backend';
import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post, Put } from '@nestjs/common';
import { Public as KeycloakPublic } from 'nest-keycloak-connect';

import {
  parseAgentHandoffCreate,
  parseAgentHandoffId,
  parseAgentHandoffProfile,
  parseAgentHandoffRespond,
  parseAgentHandoffTargetId,
} from '../dto/agent-handoff.dto';
import { AgentContextMcpService } from '../services/agent-context-mcp.service';
import { AgentHandoffsApiService } from '../services/agent-handoffs-api.service';
import { authenticateAgentContextCall } from '../utils/agent-context-auth.utils';

/**
 * Agent-facing handoff API used by the worker `agenstra` MCP server (`agenstra_handoff_*` tools).
 *
 * Same trust model as the context API: user auth guards are bypassed (`@Public`) and callers authenticate
 * with the per-agent context token. Every request is bound to the authenticated agent; the controller only
 * accepts targets of the same workspace.
 */
@Public()
@KeycloakPublic()
@Controller(`${AGENSTRA_CONTEXT_API_ROUTE}/${AGENSTRA_HANDOFFS_API_SEGMENT}`)
export class AgentsHandoffsController {
  constructor(
    private readonly contextMcp: AgentContextMcpService,
    private readonly handoffs: AgentHandoffsApiService,
  ) {}

  @Get('agents')
  async agents(
    @Headers(AGENSTRA_CONTEXT_API_HEADERS.agentId) agentId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<AgentHandoffAgentsResponse> {
    return this.handoffs.agents(await this.authenticate(agentId, authorization));
  }

  /** Metadata + handoff profile of a peer of the workspace; a missing profile is generated first. */
  @Get('agents/:agentId/profile')
  async peerProfile(
    @Param('agentId') targetAgentId: string,
    @Headers(AGENSTRA_CONTEXT_API_HEADERS.agentId) agentId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<AgentHandoffAgentSummary> {
    const id = await this.authenticate(agentId, authorization);

    return this.handoffs.peerProfile(id, parseAgentHandoffTargetId(targetAgentId));
  }

  /** The calling agent's own handoff profile (what its peers read about it). */
  @Put('profile')
  async updateProfile(
    @Body() body: unknown,
    @Headers(AGENSTRA_CONTEXT_API_HEADERS.agentId) agentId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<AgentHandoffSelfSummary> {
    const id = await this.authenticate(agentId, authorization);

    return this.handoffs.updateProfile(id, parseAgentHandoffProfile(body));
  }

  @Post()
  async create(
    @Body() body: unknown,
    @Headers(AGENSTRA_CONTEXT_API_HEADERS.agentId) agentId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<AgentHandoffResponse> {
    const id = await this.authenticate(agentId, authorization);

    return this.handoffs.create(id, parseAgentHandoffCreate(body));
  }

  @Get(':handoffId')
  async get(
    @Param('handoffId') handoffId: string,
    @Headers(AGENSTRA_CONTEXT_API_HEADERS.agentId) agentId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<AgentHandoffResponse> {
    const id = await this.authenticate(agentId, authorization);

    return this.handoffs.get(id, parseAgentHandoffId(handoffId));
  }

  @Post(':handoffId/response')
  @HttpCode(HttpStatus.OK)
  async respond(
    @Param('handoffId') handoffId: string,
    @Body() body: unknown,
    @Headers(AGENSTRA_CONTEXT_API_HEADERS.agentId) agentId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<AgentHandoffResponse> {
    const id = await this.authenticate(agentId, authorization);

    return this.handoffs.respond(id, parseAgentHandoffId(handoffId), parseAgentHandoffRespond(body));
  }

  private authenticate(agentId: string | undefined, authorization: string | undefined): Promise<string> {
    return authenticateAgentContextCall(this.contextMcp, agentId, authorization);
  }
}
