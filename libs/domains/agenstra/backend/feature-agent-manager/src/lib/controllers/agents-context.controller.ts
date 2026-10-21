import {
  AGENSTRA_CONTEXT_API_HEADERS,
  AGENSTRA_CONTEXT_API_ROUTE,
  AGENSTRA_CONTEXT_MCP_SERVER_KEY,
  AGENSTRA_CONTEXT_MCP_TOOL_NAMES,
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
  NotFoundException,
  Optional,
  Param,
  Post,
  Query,
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
import { AgentToolCallsService } from '../services/agent-tool-calls.service';
import type { AgentContextTicketRecord } from '../types/agent-context.types';
import { authenticateAgentContextCall } from '../utils/agent-context-auth.utils';

/** Session key of tickets minted for hidden sessions (see the agents gateway). */
const HIDDEN_SESSION_KEY_PREFIX = 'suffix:';

/** Same refs (order and duplicates do not matter). */
function sameRefs(requested: unknown, refs: string[]): boolean {
  if (!Array.isArray(requested)) {
    return false;
  }

  const left = new Set(requested.map((ref) => String(ref).trim().toLowerCase()));
  const right = new Set(refs.map((ref) => ref.trim().toLowerCase()));

  return left.size === right.size && [...left].every((ref) => right.has(ref));
}

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
    @Optional() private readonly toolCalls?: AgentToolCallsService,
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
    const record = await this.resolveTicket(agentId, authorization, ticket);

    await this.requireToolCall(record, AGENSTRA_CONTEXT_MCP_TOOL_NAMES.list, () => true);

    return this.api.list(record);
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

    await this.requireToolCall(record, AGENSTRA_CONTEXT_MCP_TOOL_NAMES.search, () => true);

    return this.api.search(record, parsed.query, parsed.kinds, parsed.limit);
  }

  @Get('tickets/:ticket/items/:ref')
  async get(
    @Param('ticket') ticket: string,
    @Param('ref') ref: string,
    @Headers(AGENSTRA_CONTEXT_API_HEADERS.agentId) agentId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<AgentContextGetResponse> {
    const record = await this.resolveTicket(agentId, authorization, ticket);

    await this.requireToolCall(
      record,
      AGENSTRA_CONTEXT_MCP_TOOL_NAMES.get,
      (input) => typeof input['ref'] === 'string' && input['ref'].trim() === ref.trim(),
    );

    return this.api.get(record, ref);
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

    await this.requireToolCall(record, AGENSTRA_CONTEXT_MCP_TOOL_NAMES.requestAccess, (input) =>
      sameRefs(input['refs'], dto.refs),
    );

    return this.api.requestAccess(record, dto.refs, dto.reason);
  }

  @Get('tickets/:ticket/access-requests/:requestId')
  async accessStatus(
    @Param('ticket') ticket: string,
    @Param('requestId') requestId: string,
    @Headers(AGENSTRA_CONTEXT_API_HEADERS.agentId) agentId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<AgentContextAccessResponse> {
    const record = await this.resolveTicket(agentId, authorization, ticket);

    await this.requireToolCall(
      record,
      AGENSTRA_CONTEXT_MCP_TOOL_NAMES.requestAccess,
      (input) => typeof input['requestId'] === 'string' && input['requestId'].trim() === requestId.trim(),
    );

    return this.api.accessStatus(record, requestId);
  }

  /**
   * Auto-approval tickets (hidden automation / plan sessions) grant context without asking anybody, so they only serve
   * requests issued as a tool call (matching ticket and arguments) that answers the platform's own prompt carrying the
   * ticket — directly or in a subagent started from it. A ticket copied into another process (e.g. a background job
   * started from a visible chat, also one that injects prompts through the OpenCode API) is useless.
   */
  private async requireToolCall(
    record: AgentContextTicketRecord,
    tool: string,
    matches: (input: Record<string, unknown>) => boolean,
  ): Promise<void> {
    if (record.accessMode !== 'auto' || !this.toolCalls) {
      return;
    }

    const authorized =
      record.sessionKey.startsWith(HIDDEN_SESSION_KEY_PREFIX) &&
      (await this.toolCalls.claim(
        record.agentId,
        record.ticket,
        `${AGENSTRA_CONTEXT_MCP_SERVER_KEY}_${tool}`,
        (input) => typeof input['ticket'] === 'string' && input['ticket'].trim() === record.ticket && matches(input),
      ));

    if (!authorized) {
      throw new NotFoundException('Unknown or expired context ticket');
    }
  }

  private authenticate(agentId: string | undefined, authorization: string | undefined): Promise<string> {
    return authenticateAgentContextCall(this.contextMcp, agentId, authorization);
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
