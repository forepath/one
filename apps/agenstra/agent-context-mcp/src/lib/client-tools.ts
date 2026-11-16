import { AGENSTRA_CLIENT_TOOLS_MCP_TOOL_NAMES } from '@forepath/agenstra/shared/util-opencode-config';

import { ContextApiClient, ContextApiError } from './context-api.client';
import type { ContextToolDefinition, ContextToolResult } from './context-tools';

const TICKET_PROPERTY = {
  type: 'string',
  description: 'Context ticket from the <client_tools> section of the prompt.',
};

/**
 * Bridge to the client tools an API client passed with the current request (OpenAI-compatible function calling).
 * The tools themselves are described in the prompt; these two tools call them.
 */
export const CLIENT_TOOL_DEFINITIONS: ContextToolDefinition[] = [
  {
    name: AGENSTRA_CLIENT_TOOLS_MCP_TOOL_NAMES.call,
    description:
      'Call a tool of the API client (listed in the <client_tools> section of the prompt). It runs on the client ' +
      'side, not in your workspace. Returns the client output, or status "pending" with a callId: then wait with ' +
      'client_tools_result.',
    inputSchema: {
      type: 'object',
      properties: {
        ticket: TICKET_PROPERTY,
        name: { type: 'string', description: 'Client tool name.' },
        arguments: {
          type: 'object',
          description: 'Arguments object matching the parameters of the client tool.',
          additionalProperties: true,
        },
      },
      required: ['ticket', 'name', 'arguments'],
      additionalProperties: false,
    },
  },
  {
    name: AGENSTRA_CLIENT_TOOLS_MCP_TOOL_NAMES.result,
    description: 'Keep waiting for a pending client tool call (callId from client_tools_call).',
    inputSchema: {
      type: 'object',
      properties: {
        ticket: TICKET_PROPERTY,
        callId: { type: 'string', description: 'callId of the pending call.' },
      },
      required: ['ticket', 'callId'],
      additionalProperties: false,
    },
  },
];

const CLIENT_TOOL_NAMES = new Set<string>(Object.values(AGENSTRA_CLIENT_TOOLS_MCP_TOOL_NAMES));

export function isClientToolName(name: string): boolean {
  return CLIENT_TOOL_NAMES.has(name);
}

function text(value: string, isError = false): ContextToolResult {
  return { content: [{ type: 'text', text: value }], ...(isError ? { isError: true } : {}) };
}

/** Dispatch one client tool bridge call. Errors become `isError` results (never thrown to the transport). */
export async function callClientTool(
  client: ContextApiClient,
  name: string,
  rawArgs: unknown,
): Promise<ContextToolResult> {
  const args = (rawArgs && typeof rawArgs === 'object' ? rawArgs : {}) as Record<string, unknown>;
  const ticket = typeof args['ticket'] === 'string' ? args['ticket'].trim() : '';

  if (!ticket) {
    return text('Missing "ticket": use the ticket of the <client_tools> section.', true);
  }

  try {
    const response =
      name === AGENSTRA_CLIENT_TOOLS_MCP_TOOL_NAMES.call
        ? await callTool(client, ticket, args)
        : name === AGENSTRA_CLIENT_TOOLS_MCP_TOOL_NAMES.result
          ? await waitTool(client, ticket, args)
          : undefined;

    if (!response) {
      return text(`Unknown tool: ${name}`, true);
    }

    if (typeof response === 'string') {
      return text(response, true);
    }

    if (response.status === 'completed') {
      return text(response.output ?? '');
    }

    if (response.status === 'pending') {
      return text(
        JSON.stringify({
          status: 'pending',
          callId: response.callId,
          next: 'The client has not answered yet: call client_tools_result with this callId.',
        }),
      );
    }

    return text(`Client tool failed: ${response.error ?? 'unknown error'}`, true);
  } catch (error) {
    const message =
      error instanceof ContextApiError || error instanceof Error ? error.message : 'Client tool request failed';

    return text(message, true);
  }
}

async function callTool(client: ContextApiClient, ticket: string, args: Record<string, unknown>) {
  const toolName = typeof args['name'] === 'string' ? args['name'].trim() : '';

  if (!toolName) {
    return 'Missing "name": the client tool to call.';
  }

  const toolArgs = args['arguments'] ?? {};

  if (typeof toolArgs !== 'object' || Array.isArray(toolArgs)) {
    return '"arguments" must be an object.';
  }

  return client.callClientTool(ticket, toolName, toolArgs);
}

async function waitTool(client: ContextApiClient, ticket: string, args: Record<string, unknown>) {
  const callId = typeof args['callId'] === 'string' ? args['callId'].trim() : '';

  if (!callId) {
    return 'Missing "callId" from client_tools_call.';
  }

  return client.waitClientTool(ticket, callId);
}
