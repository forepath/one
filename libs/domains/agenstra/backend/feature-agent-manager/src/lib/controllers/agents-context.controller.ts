import {
  AGENSTRA_CONTENT_CHANGES_API_SEGMENT,
  AGENSTRA_CONTENT_MCP_TOOL_NAMES,
  AGENSTRA_CONTEXT_API_HEADERS,
  AGENSTRA_CONTEXT_API_ROUTE,
  AGENSTRA_CONTEXT_MCP_SERVER_KEY,
  AGENSTRA_CONTEXT_MCP_TOOL_NAMES,
  agentContentToolForOperation,
  type AgentContentChangeResponse,
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

import {
  parseAgentContextAccessRequest,
  parseAgentContextSearchQuery,
  type AgentContextSearchQueryDto,
} from '../dto/agent-context.dto';
import { AgentContextApiService } from '../services/agent-context-api.service';
import { AgentContextChangesService } from '../services/agent-context-changes.service';
import { AgentContextMcpService } from '../services/agent-context-mcp.service';
import { AgentContextTicketsService } from '../services/agent-context-tickets.service';
import { AgentToolCallsService } from '../services/agent-tool-calls.service';
import type { AgentContextTicketRecord } from '../types/agent-context.types';
import { authenticateAgentContextCall } from '../utils/agent-context-auth.utils';

/** Session key of tickets minted for hidden sessions (see the agents gateway). */
const HIDDEN_SESSION_KEY_PREFIX = 'suffix:';

/** Change fields an MCP content tool call must carry unchanged (see {@link AgentsContextController.requestChange}). */
const CHANGE_ARG_FIELDS = [
  'ref',
  'parentRef',
  'revision',
  'title',
  'content',
  'body',
  'priority',
  'status',
  'nodeType',
];

/** The tool call carries exactly the change fields the request carries (absent or empty parents are equal). */
function sameChangeArgs(input: Record<string, unknown>, body: Record<string, unknown>): boolean {
  return CHANGE_ARG_FIELDS.every((field) => {
    const left = typeof input[field] === 'string' ? input[field] : undefined;
    const right = typeof body[field] === 'string' ? body[field] : undefined;

    return (left || undefined) === (right || undefined);
  });
}

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
@Controller(AGENSTRA_CONTEXT_API_ROUTE)
export class AgentsContextController {
  constructor(
    private readonly contextMcp: AgentContextMcpService,
    private readonly tickets: AgentContextTicketsService,
    private readonly api: AgentContextApiService,
    private readonly changes: AgentContextChangesService,
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

  /** One ticket / knowledge change (`agenstra_content_*`): decided by the user or the run's opt-in, then applied. */
  @Post(`tickets/:ticket/${AGENSTRA_CONTENT_CHANGES_API_SEGMENT}`)
  @HttpCode(HttpStatus.OK)
  async requestChange(
    @Param('ticket') ticket: string,
    @Body() body: unknown,
    @Headers(AGENSTRA_CONTEXT_API_HEADERS.agentId) agentId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<AgentContentChangeResponse> {
    const record = await this.resolveTicket(agentId, authorization, ticket);
    const parsed = this.changes.parse(body);
    const raw = (body ?? {}) as Record<string, unknown>;

    await this.requireToolCall(record, agentContentToolForOperation(parsed.request.operation), (input) =>
      sameChangeArgs(input, raw),
    );

    return this.changes.requestChange(record, parsed);
  }

  @Get(`tickets/:ticket/${AGENSTRA_CONTENT_CHANGES_API_SEGMENT}/:requestId`)
  async changeStatus(
    @Param('ticket') ticket: string,
    @Param('requestId') requestId: string,
    @Headers(AGENSTRA_CONTEXT_API_HEADERS.agentId) agentId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<AgentContentChangeResponse> {
    const record = await this.resolveTicket(agentId, authorization, ticket);

    await this.requireToolCall(
      record,
      AGENSTRA_CONTENT_MCP_TOOL_NAMES.changeStatus,
      (input) => typeof input['requestId'] === 'string' && input['requestId'].trim() === requestId.trim(),
    );

    return this.changes.changeStatus(record, requestId);
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
