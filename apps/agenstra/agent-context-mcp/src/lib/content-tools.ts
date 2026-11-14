import {
  AGENSTRA_CONTENT_MCP_TOOL_NAMES,
  AGENT_CONTENT_LIMITS,
  AGENT_CONTENT_TICKET_PRIORITIES,
  AGENT_CONTENT_TICKET_STATUSES,
  AGENT_CONTENT_TOOL_OPERATIONS,
  type AgentContentChangeRequest,
} from '@forepath/agenstra/shared/util-opencode-config';

import { ContextApiClient, ContextApiError } from './context-api.client';
import type { ContextToolDefinition, ContextToolResult } from './context-tools';

const TICKET_PROPERTY = {
  type: 'string',
  description: 'Context ticket from the prompt hint (starts with "ctx-").',
};
const REASON_PROPERTY = {
  type: 'string',
  maxLength: AGENT_CONTENT_LIMITS.reasonMaxLength,
  description: 'Why the change is needed (shown to the user who approves it).',
};
const REVISION_PROPERTY = {
  type: 'string',
  description: 'Revision returned by context_get for this element; the change fails when it was changed since.',
};
const TITLE_PROPERTY = { type: 'string', maxLength: AGENT_CONTENT_LIMITS.titleMaxLength, description: 'Title.' };
const CONTENT_PROPERTY = {
  type: 'string',
  maxLength: AGENT_CONTENT_LIMITS.contentMaxLength,
  description: 'Full markdown content (replaces the current content).',
};
const TICKET_FIELD_PROPERTIES = {
  title: TITLE_PROPERTY,
  content: CONTENT_PROPERTY,
  priority: { type: 'string', enum: [...AGENT_CONTENT_TICKET_PRIORITIES] },
  status: { type: 'string', enum: [...AGENT_CONTENT_TICKET_STATUSES] },
};
const APPROVAL_NOTE =
  'In chats the user approves every change (the call waits); unattended runs only make changes a user allowed for ' +
  'them. If the result is "pending", call content_change_status with the returned requestId to keep waiting.';

function tool(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
): ContextToolDefinition {
  return {
    name,
    description: `${description} ${APPROVAL_NOTE}`,
    inputSchema: {
      type: 'object',
      properties: { ticket: TICKET_PROPERTY, ...properties, reason: REASON_PROPERTY },
      required: ['ticket', ...required],
      additionalProperties: false,
    },
  };
}

export const CONTENT_TOOL_DEFINITIONS: ContextToolDefinition[] = [
  tool(
    AGENSTRA_CONTENT_MCP_TOOL_NAMES.ticketCreate,
    'Create a ticket in this workspace, optionally as subtask of a ticket you may read (parentRef "ticket:<sha>").',
    { parentRef: { type: 'string', description: 'Parent ticket ref (ticket:<sha>).' }, ...TICKET_FIELD_PROPERTIES },
    ['title'],
  ),
  tool(
    AGENSTRA_CONTENT_MCP_TOOL_NAMES.ticketUpdate,
    'Change title, content, priority and/or status of a ticket you may read (ref "ticket:<sha>"); only the given ' +
      'fields change.',
    { ref: { type: 'string', description: 'ticket:<sha>.' }, revision: REVISION_PROPERTY, ...TICKET_FIELD_PROPERTIES },
    ['ref', 'revision'],
  ),
  tool(
    AGENSTRA_CONTENT_MCP_TOOL_NAMES.ticketComment,
    'Add a comment to a ticket you may read (ref "ticket:<sha>").',
    {
      ref: { type: 'string', description: 'ticket:<sha>.' },
      body: { type: 'string', maxLength: AGENT_CONTENT_LIMITS.commentMaxLength, description: 'Comment (markdown).' },
    },
    ['ref', 'body'],
  ),
  tool(
    AGENSTRA_CONTENT_MCP_TOOL_NAMES.ticketDelete,
    'Delete a ticket you may read (ref "ticket:<sha>"). Tickets with subtasks cannot be deleted.',
    { ref: { type: 'string', description: 'ticket:<sha>.' }, revision: REVISION_PROPERTY },
    ['ref', 'revision'],
  ),
  tool(
    AGENSTRA_CONTENT_MCP_TOOL_NAMES.pageCreate,
    'Create a knowledge page (or folder) in this workspace, optionally inside a folder you may read (parentRef ' +
      '"knowledge:<sha>").',
    {
      parentRef: { type: 'string', description: 'Parent folder ref (knowledge:<sha>).' },
      title: TITLE_PROPERTY,
      content: CONTENT_PROPERTY,
      nodeType: { type: 'string', enum: ['page', 'folder'], description: 'Defaults to page.' },
    },
    ['title'],
  ),
  tool(
    AGENSTRA_CONTENT_MCP_TOOL_NAMES.pageUpdate,
    'Change title and/or content of a knowledge page you may read (ref "knowledge:<sha>"); only the given fields ' +
      'change.',
    {
      ref: { type: 'string', description: 'knowledge:<sha>.' },
      revision: REVISION_PROPERTY,
      title: TITLE_PROPERTY,
      content: CONTENT_PROPERTY,
    },
    ['ref', 'revision'],
  ),
  tool(
    AGENSTRA_CONTENT_MCP_TOOL_NAMES.planUpdate,
    'Change title and/or plan markdown of a chat plan of your environment you may read (ref "plan:<sha>"). Only ' +
      'plans that were never executed can change (executed plans are read-only); the saved version is exactly what ' +
      'runs when the plan is executed. Pass the full new plan as content; only the given fields change.',
    {
      ref: { type: 'string', description: 'plan:<sha>.' },
      revision: REVISION_PROPERTY,
      title: TITLE_PROPERTY,
      content: CONTENT_PROPERTY,
    },
    ['ref', 'revision'],
  ),
  tool(
    AGENSTRA_CONTENT_MCP_TOOL_NAMES.pageDelete,
    'Delete a knowledge page or empty folder you may read (ref "knowledge:<sha>").',
    { ref: { type: 'string', description: 'knowledge:<sha>.' }, revision: REVISION_PROPERTY },
    ['ref', 'revision'],
  ),
  {
    name: AGENSTRA_CONTENT_MCP_TOOL_NAMES.changeStatus,
    description: 'Keep waiting on a pending content change (requestId from a content_* result).',
    inputSchema: {
      type: 'object',
      properties: {
        ticket: TICKET_PROPERTY,
        requestId: { type: 'string', description: 'requestId of the pending change.' },
      },
      required: ['ticket', 'requestId'],
      additionalProperties: false,
    },
  },
];

const CONTENT_TOOL_NAMES = new Set<string>(Object.values(AGENSTRA_CONTENT_MCP_TOOL_NAMES));

export function isContentToolName(name: string): boolean {
  return CONTENT_TOOL_NAMES.has(name);
}

function text(value: string, isError = false): ContextToolResult {
  return { content: [{ type: 'text', text: value }], ...(isError ? { isError: true } : {}) };
}

function json(value: unknown): ContextToolResult {
  return text(JSON.stringify(value, null, 2));
}

const CHANGE_FIELDS = ['ref', 'parentRef', 'revision', 'title', 'content', 'body', 'priority', 'status', 'nodeType'];

/** Copy the known string fields of a change; semantic validation happens in the manager. */
function changeRequest(operation: string, args: Record<string, unknown>): AgentContentChangeRequest {
  const change: Record<string, unknown> = { operation };

  for (const key of [...CHANGE_FIELDS, 'reason']) {
    if (typeof args[key] === 'string') {
      change[key] = args[key];
    }
  }

  return change as AgentContentChangeRequest;
}

/** Dispatch one content tool call. Errors become `isError` results (never thrown to the transport). */
export async function callContentTool(
  client: ContextApiClient,
  name: string,
  rawArgs: unknown,
): Promise<ContextToolResult> {
  const args = (rawArgs && typeof rawArgs === 'object' ? rawArgs : {}) as Record<string, unknown>;
  const ticket = typeof args['ticket'] === 'string' ? args['ticket'].trim() : '';

  if (!ticket) {
    return text('Missing "ticket": pass the context ticket from the prompt hint.', true);
  }

  try {
    if (name === AGENSTRA_CONTENT_MCP_TOOL_NAMES.changeStatus) {
      const requestId = typeof args['requestId'] === 'string' ? args['requestId'].trim() : '';

      if (!requestId) {
        return text('Missing "requestId".', true);
      }

      return json(await client.changeStatus(ticket, requestId));
    }

    const operation = AGENT_CONTENT_TOOL_OPERATIONS[name];

    if (!operation) {
      return text(`Unknown tool: ${name}`, true);
    }

    return json(await client.requestChange(ticket, changeRequest(operation, args)));
  } catch (error) {
    const message =
      error instanceof ContextApiError || error instanceof Error ? error.message : 'Content change failed';

    return text(message, true);
  }
}
