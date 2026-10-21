import {
  AGENSTRA_CONTEXT_API_HEADERS,
  AGENSTRA_CONTEXT_API_ROUTE,
  type AgentContextAccessResponse,
  type AgentContextGetResponse,
  type AgentContextListResponse,
  type AgentContextSearchResponse,
} from '@forepath/agenstra/shared/util-opencode-config';
import { Public } from '@forepath/identity/backend';
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { Public as KeycloakPublic } from 'nest-keycloak-connect';

import {
  parseAgentContextAccessRequest,
  parseAgentContextSearchQuery,
  type AgentContextSearchQueryDto,
} from '../dto/agent-context.dto';
import { AgentContextApiService } from '../services/agent-context-api.service';
import { AgentContextMcpService } from '../services/agent-context-mcp.service';
import { AgentContextTicketsService } from '../services/agent-context-tickets.service';
import type { AgentContextTicketRecord } from '../types/agent-context.types';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Agent-facing context API used by the worker `agenstra` MCP server.
 *
 * Not reachable with user credentials: callers authenticate with the per-agent context token
 * (`Authorization: Bearer`, `x-agenstra-agent-id`) and every context route additionally needs a
 * context ticket minted for that same agent. User auth guards are bypassed on purpose (`@Public`).
 */
@Public()
@KeycloakPublic()
@Controller(AGENSTRA_CONTEXT_API_ROUTE)
export class AgentsContextController {
  constructor(
    private readonly contextMcp: AgentContextMcpService,
    private readonly tickets: AgentContextTicketsService,
    private readonly api: AgentContextApiService,
  ) {}

  /** MCP server startup probe: verifies reachability and the agent token. */
  @Get('health')
  @HttpCode(HttpStatus.NO_CONTENT)
  async health(
    @Headers(AGENSTRA_CONTEXT_API_HEADERS.agentId) agentId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<void> {
    await this.authenticate(agentId, authorization);
  }

  @Get('tickets/:ticket')
  async list(
    @Param('ticket') ticket: string,
    @Headers(AGENSTRA_CONTEXT_API_HEADERS.agentId) agentId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<AgentContextListResponse> {
    return this.api.list(await this.resolveTicket(agentId, authorization, ticket));
  }

  @Get('tickets/:ticket/search')
  async search(
    @Param('ticket') ticket: string,
    @Query() query: AgentContextSearchQueryDto,
    @Headers(AGENSTRA_CONTEXT_API_HEADERS.agentId) agentId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<AgentContextSearchResponse> {
    const record = await this.resolveTicket(agentId, authorization, ticket);
    const parsed = parseAgentContextSearchQuery(query);

    return this.api.search(record, parsed.query, parsed.kinds, parsed.limit);
  }

  @Get('tickets/:ticket/items/:ref')
  async get(
    @Param('ticket') ticket: string,
    @Param('ref') ref: string,
    @Headers(AGENSTRA_CONTEXT_API_HEADERS.agentId) agentId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<AgentContextGetResponse> {
    return this.api.get(await this.resolveTicket(agentId, authorization, ticket), ref);
  }

  @Post('tickets/:ticket/access-requests')
  @HttpCode(HttpStatus.OK)
  async requestAccess(
    @Param('ticket') ticket: string,
    @Body() body: unknown,
    @Headers(AGENSTRA_CONTEXT_API_HEADERS.agentId) agentId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<AgentContextAccessResponse> {
    const record = await this.resolveTicket(agentId, authorization, ticket);
    const dto = parseAgentContextAccessRequest(body);

    return this.api.requestAccess(record, dto.refs, dto.reason);
  }

  @Get('tickets/:ticket/access-requests/:requestId')
  async accessStatus(
    @Param('ticket') ticket: string,
    @Param('requestId') requestId: string,
    @Headers(AGENSTRA_CONTEXT_API_HEADERS.agentId) agentId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<AgentContextAccessResponse> {
    return this.api.accessStatus(await this.resolveTicket(agentId, authorization, ticket), requestId);
  }

  private async authenticate(agentId: string | undefined, authorization: string | undefined): Promise<string> {
    const id = agentId?.trim() ?? '';
    const [scheme, token] = (authorization ?? '').trim().split(/\s+/, 2);

    if (!UUID_V4.test(id) || scheme !== 'Bearer' || !token || !(await this.contextMcp.verifyAgentToken(id, token))) {
      throw new UnauthorizedException('Invalid agent context credentials');
    }

    return id;
  }

  private async resolveTicket(
    agentId: string | undefined,
    authorization: string | undefined,
    ticket: string,
  ): Promise<AgentContextTicketRecord> {
    const id = await this.authenticate(agentId, authorization);

    return this.tickets.resolve(id, ticket);
  }
}
