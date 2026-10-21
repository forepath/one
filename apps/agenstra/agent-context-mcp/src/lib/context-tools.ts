import { AGENSTRA_CONTEXT_MCP_TOOL_NAMES } from '@forepath/agenstra/shared/util-opencode-config';

import { ContextApiClient, ContextApiError } from './context-api.client';

/** MCP tool definition (JSON Schema input) — served via `tools/list`. */
export interface ContextToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

export interface ContextToolResult {
  [key: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

const TICKET_PROPERTY = {
  type: 'string',
  description: 'Context ticket from the prompt hint (starts with "ctx-").',
};

export const CONTEXT_TOOL_DEFINITIONS: ContextToolDefinition[] = [
  {
    name: AGENSTRA_CONTEXT_MCP_TOOL_NAMES.list,
    description:
      'List the context granted for this request: context items (tickets, knowledge pages, excerpts) with titles and ' +
      'sizes, mounted attachments, workspace and environment mounts. Content is read with context_get.',
    inputSchema: {
      type: 'object',
      properties: { ticket: TICKET_PROPERTY },
      required: ['ticket'],
      additionalProperties: false,
    },
  },
  {
    name: AGENSTRA_CONTEXT_MCP_TOOL_NAMES.search,
    description:
      'Search workspace tickets and knowledge pages by title or SHA. Returns metadata only (ref, title, status, ' +
      'parent, size, granted). Read granted refs with context_get; request others with context_request_access.',
    inputSchema: {
      type: 'object',
      properties: {
        ticket: TICKET_PROPERTY,
        query: { type: 'string', description: 'Title fragment or SHA prefix. Omit to list recent elements.' },
        kinds: {
          type: 'array',
          items: { type: 'string', enum: ['ticket', 'knowledge'] },
          description: 'Restrict to tickets and/or knowledge pages.',
        },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Max results (default 20).' },
      },
      required: ['ticket'],
      additionalProperties: false,
    },
  },
  {
    name: AGENSTRA_CONTEXT_MCP_TOOL_NAMES.get,
    description:
      'Read the full content of a context element: "item:<n>" from the prompt hint / context_list, or a granted ' +
      '"ticket:<sha>" / "knowledge:<sha>".',
    inputSchema: {
      type: 'object',
      properties: {
        ticket: TICKET_PROPERTY,
        ref: { type: 'string', description: 'item:<n>, ticket:<sha> or knowledge:<sha>.' },
      },
      required: ['ticket', 'ref'],
      additionalProperties: false,
    },
  },
  {
    name: AGENSTRA_CONTEXT_MCP_TOOL_NAMES.requestAccess,
    description:
      'Ask for access to tickets / knowledge pages that are not granted yet (refs from context_search). The user ' +
      'may be asked to approve; unattended sessions decide automatically. If the result is "pending", call again ' +
      'with the returned requestId to keep waiting.',
    inputSchema: {
      type: 'object',
      properties: {
        ticket: TICKET_PROPERTY,
        refs: {
          type: 'array',
          items: { type: 'string' },
          maxItems: 20,
          description: 'ticket:<sha> / knowledge:<sha> refs to request.',
        },
        reason: { type: 'string', description: 'Why the content is needed (shown to the user).' },
        requestId: { type: 'string', description: 'Continue waiting on a pending request instead of creating one.' },
      },
      required: ['ticket'],
      additionalProperties: false,
    },
  },
];

function text(value: string, isError = false): ContextToolResult {
  return { content: [{ type: 'text', text: value }], ...(isError ? { isError: true } : {}) };
}

function json(value: unknown): ContextToolResult {
  return text(JSON.stringify(value, null, 2));
}

function stringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];

  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringArrayArg(args: Record<string, unknown>, key: string): string[] | undefined {
  const value = args[key];

  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : undefined;
}

/** Dispatch one MCP `tools/call`. Errors become `isError` results (never thrown to the transport). */
export async function callContextTool(
  client: ContextApiClient,
  name: string,
  rawArgs: unknown,
): Promise<ContextToolResult> {
  const args = (rawArgs && typeof rawArgs === 'object' ? rawArgs : {}) as Record<string, unknown>;
  const ticket = stringArg(args, 'ticket');

  if (!ticket) {
    return text('Missing "ticket": pass the context ticket from the prompt hint.', true);
  }

  try {
    switch (name) {
      case AGENSTRA_CONTEXT_MCP_TOOL_NAMES.list:
        return json(await client.list(ticket));
      case AGENSTRA_CONTEXT_MCP_TOOL_NAMES.search: {
        const limit = typeof args['limit'] === 'number' ? args['limit'] : undefined;

        return json(
          await client.search(ticket, { query: stringArg(args, 'query'), kinds: stringArrayArg(args, 'kinds'), limit }),
        );
      }
      case AGENSTRA_CONTEXT_MCP_TOOL_NAMES.get: {
        const ref = stringArg(args, 'ref');

        if (!ref) {
          return text('Missing "ref" (item:<n>, ticket:<sha> or knowledge:<sha>).', true);
        }

        const item = await client.get(ticket, ref);

        return text(`# ${item.title} (${item.ref})\n\n${item.content}`);
      }
      case AGENSTRA_CONTEXT_MCP_TOOL_NAMES.requestAccess: {
        const requestId = stringArg(args, 'requestId');

        if (requestId) {
          return json(await client.accessStatus(ticket, requestId));
        }

        const refs = stringArrayArg(args, 'refs') ?? [];

        if (refs.length === 0) {
          return text('Provide "refs" to request, or "requestId" to continue waiting.', true);
        }

        return json(await client.requestAccess(ticket, refs, stringArg(args, 'reason')));
      }
      default:
        return text(`Unknown tool: ${name}`, true);
    }
  } catch (error) {
    const message =
      error instanceof ContextApiError || error instanceof Error ? error.message : 'Context request failed';

    return text(message, true);
  }
}
