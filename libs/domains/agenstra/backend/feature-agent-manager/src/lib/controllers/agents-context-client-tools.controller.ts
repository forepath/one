import {
  AGENSTRA_CLIENT_TOOLS_API_SEGMENT,
  AGENSTRA_CLIENT_TOOLS_MCP_TOOL_NAMES,
  AGENSTRA_CONTEXT_API_HEADERS,
  AGENSTRA_CONTEXT_API_ROUTE,
  AGENSTRA_CONTEXT_MCP_SERVER_KEY,
  serializeClientToolArguments,
  type AgentClientToolCallResponse,
} from '@forepath/agenstra/shared/util-opencode-config';
import { Public } from '@forepath/identity/backend';
import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Optional,
  Param,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';

import { AgentClientToolsApiService } from '../services/agent-client-tools-api.service';
import { AgentContextMcpService } from '../services/agent-context-mcp.service';
import { AgentContextTicketsService } from '../services/agent-context-tickets.service';
import { AgentToolCallsService } from '../services/agent-tool-calls.service';
import type { AgentContextTicketRecord } from '../types/agent-context.types';
import { authenticateAgentContextCall } from '../utils/agent-context-auth.utils';

function canonicalArguments(raw: unknown): string | undefined {
  try {
    return serializeClientToolArguments(raw);
  } catch {
    return undefined;
  }
}

/**
 * Agent-facing client tool bridge used by the worker `agenstra` MCP server (`agenstra_client_tools_*`).
 *
 * Same authentication as the context API (per-agent token + context ticket of the turn). Every request additionally
 * needs a matching `agenstra_client_tools_*` tool call answering the platform's prompt of that ticket: client tools
 * run on the API client's side (e.g. with side effects in another system), so a process in the worker that read the
 * ticket can never trigger a call by itself.
 */
@Public()
@Controller(`${AGENSTRA_CONTEXT_API_ROUTE}/${AGENSTRA_CLIENT_TOOLS_API_SEGMENT}`)
export class AgentsContextClientToolsController {
  constructor(
    private readonly contextMcp: AgentContextMcpService,
    private readonly tickets: AgentContextTicketsService,
    private readonly clientTools: AgentClientToolsApiService,
    @Optional() private readonly toolCalls?: AgentToolCallsService,
  ) {}

  @Post(':ticket/calls')
  @HttpCode(HttpStatus.OK)
  async call(
    @Param('ticket') ticket: string,
    @Body() body: Record<string, unknown> | undefined,
    @Headers(AGENSTRA_CONTEXT_API_HEADERS.agentId) agentId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<AgentClientToolCallResponse> {
    const record = await this.resolve(agentId, authorization, ticket);
    const name = typeof body?.['name'] === 'string' ? body['name'] : '';
    const args = canonicalArguments(body?.['arguments']);

    if (!name || args === undefined) {
      throw new BadRequestException('name and an arguments object are required');
    }

    await this.requireToolCall(
      record,
      AGENSTRA_CLIENT_TOOLS_MCP_TOOL_NAMES.call,
      (input) => input['name'] === name && canonicalArguments(input['arguments']) === args,
    );

    return this.clientTools.call(record, name, args);
  }

  @Post(':ticket/calls/:callId/wait')
  @HttpCode(HttpStatus.OK)
  async wait(
    @Param('ticket') ticket: string,
    @Param('callId') callId: string,
    @Headers(AGENSTRA_CONTEXT_API_HEADERS.agentId) agentId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<AgentClientToolCallResponse> {
    const record = await this.resolve(agentId, authorization, ticket);

    await this.requireToolCall(
      record,
      AGENSTRA_CLIENT_TOOLS_MCP_TOOL_NAMES.result,
      (input) => typeof input['callId'] === 'string' && input['callId'].trim() === callId,
    );

    return this.clientTools.wait(record, callId);
  }

  private async resolve(
    agentId: string | undefined,
    authorization: string | undefined,
    ticket: string,
  ): Promise<AgentContextTicketRecord> {
    const id = await authenticateAgentContextCall(this.contextMcp, agentId, authorization);
    const record = this.tickets.resolve(id, ticket);

    if (!record.clientTools?.length) {
      // Same answer as an unknown ticket: tickets without client tools cannot be told apart.
      throw new NotFoundException('Unknown or expired context ticket');
    }

    return record;
  }

  /** Always required (also in visible chats): each tool call of the agent authorizes exactly one request. */
  private async requireToolCall(
    record: AgentContextTicketRecord,
    tool: string,
    matches: (input: Record<string, unknown>) => boolean,
  ): Promise<void> {
    if (!this.toolCalls) {
      throw new ServiceUnavailableException('Client tools are not available');
    }

    const authorized = await this.toolCalls.claim(
      record.agentId,
      record.ticket,
      `${AGENSTRA_CONTEXT_MCP_SERVER_KEY}_${tool}`,
      (input) => typeof input['ticket'] === 'string' && input['ticket'].trim() === record.ticket && matches(input),
    );

    if (!authorized) {
      throw new NotFoundException('Unknown or expired context ticket');
    }
  }
}
