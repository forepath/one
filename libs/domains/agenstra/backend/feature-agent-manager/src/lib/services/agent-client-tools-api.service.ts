import { randomBytes } from 'crypto';

import {
  CLIENT_TOOL_CALL_ID_PATTERN,
  CLIENT_TOOL_LIMITS,
  ClientToolsValidationError,
  serializeClientToolArguments,
  type AgentClientToolCallResponse,
  type AgentClientToolRequest,
  type AgentClientToolResponse,
} from '@forepath/agenstra/shared/util-opencode-config';
import { BadRequestException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';

import type { AgentContextTicketRecord } from '../types/agent-context.types';

/** Runtime hook provided by the agents gateway (registered on module init). */
export interface AgentClientToolsGatewayBridge {
  /** Hand a client tool call / wait to the controller connection that started the ticket's turn. */
  requestControllerClientTool(
    record: AgentContextTicketRecord,
    request: AgentClientToolRequest,
  ): Promise<AgentClientToolResponse>;
}

function truncateOutput(output: string): string {
  return output.length > CLIENT_TOOL_LIMITS.outputMaxChars
    ? `${output.slice(0, CLIENT_TOOL_LIMITS.outputMaxChars)}… [truncated ${output.length - CLIENT_TOOL_LIMITS.outputMaxChars} characters]`
    : output;
}

/**
 * Agent-facing client tool bridge (worker MCP server, `agenstra_client_tools_*`). Client tools are defined by the API
 * client of a turn (OpenAI-compatible function calling) and live on that turn's context ticket; each call is handed to
 * the controller connection that started the turn, which passes it to the API client and returns its result.
 */
@Injectable()
export class AgentClientToolsApiService {
  private bridge?: AgentClientToolsGatewayBridge;

  registerBridge(bridge: AgentClientToolsGatewayBridge): void {
    this.bridge = bridge;
  }

  /** Start a call of one of the ticket's client tools; waits for the client's result (or answers `pending`). */
  async call(
    record: AgentContextTicketRecord,
    name: string,
    rawArguments: unknown,
  ): Promise<AgentClientToolCallResponse> {
    const tools = record.clientTools ?? [];

    if (!tools.some((tool) => tool.name === name)) {
      throw new NotFoundException(`Unknown client tool '${name}'`);
    }

    let args: string;

    try {
      args = serializeClientToolArguments(rawArguments);
    } catch (error) {
      throw new BadRequestException(error instanceof ClientToolsValidationError ? error.message : 'Invalid arguments');
    }

    if (Buffer.byteLength(args, 'utf8') > CLIENT_TOOL_LIMITS.argumentsMaxBytes) {
      throw new BadRequestException(`arguments must be at most ${CLIENT_TOOL_LIMITS.argumentsMaxBytes} bytes`);
    }

    const callIds = record.clientToolCallIds ?? (record.clientToolCallIds = []);

    if (callIds.length >= CLIENT_TOOL_LIMITS.maxCallsPerTurn) {
      throw new HttpException(
        `At most ${CLIENT_TOOL_LIMITS.maxCallsPerTurn} client tool calls per request`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const callId = `call_${randomBytes(18).toString('hex')}`;

    callIds.push(callId);

    return this.forward(record, callId, {
      op: 'call',
      agentId: record.agentId,
      ...(record.chatId ? { chatId: record.chatId } : {}),
      correlationId: record.correlationId,
      callId,
      name,
      arguments: args,
    });
  }

  /** Keep waiting for the result of a pending call of this ticket. */
  async wait(record: AgentContextTicketRecord, callId: string): Promise<AgentClientToolCallResponse> {
    if (!CLIENT_TOOL_CALL_ID_PATTERN.test(callId) || !(record.clientToolCallIds ?? []).includes(callId)) {
      throw new NotFoundException('Unknown client tool call');
    }

    return this.forward(record, callId, {
      op: 'wait',
      agentId: record.agentId,
      correlationId: record.correlationId,
      callId,
    });
  }

  private async forward(
    record: AgentContextTicketRecord,
    callId: string,
    request: AgentClientToolRequest,
  ): Promise<AgentClientToolCallResponse> {
    if (!this.bridge) {
      return { callId, status: 'failed', error: 'Client tools are not available' };
    }

    const response = await this.bridge.requestControllerClientTool(record, request);

    if (response.ok === false) {
      return { callId, status: 'failed', error: (response as { error: string }).error };
    }

    if (response.status === 'completed') {
      return { callId, status: 'completed', output: truncateOutput(response.output) };
    }

    if (response.status === 'failed') {
      return { callId, status: 'failed', error: response.error };
    }

    return { callId, status: 'pending' };
  }
}
