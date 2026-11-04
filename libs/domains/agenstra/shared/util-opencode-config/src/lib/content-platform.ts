/**
 * Content changes: agents create, update, comment on and delete workspace tickets and knowledge pages, and update chat
 * plans of their own environment that were not executed yet, through the platform `agenstra` MCP server
 * (`agenstra_content_*` tools). Changes use the context ticket of the prompt (like the
 * `agenstra_context_*` read tools) and only target elements the session may read.
 *
 * Every change is decided by the manager before the controller applies it:
 * - visible chats: the user approves each change (permission-style prompt; "allow for this chat" covers further
 *   changes of the same operation on the same element);
 * - unattended runs (scheduled tasks, ticket automation): only the operations a workspace user explicitly allowed for
 *   that task / automation (approved content); the controller checks them again when it applies the change;
 * - plans and other hidden helper sessions: never.
 *
 * The tools deliberately do not share the `agenstra_context_*` prefix: plan sessions allow (and auto-answer) that
 * prefix as read-only explore tools.
 */

/** OpenCode names MCP tools `<server>_<tool>`, so the agent sees `agenstra_content_*`. */
export const AGENSTRA_CONTENT_MCP_TOOL_NAMES = {
  ticketCreate: 'content_ticket_create',
  ticketUpdate: 'content_ticket_update',
  ticketComment: 'content_ticket_comment',
  ticketDelete: 'content_ticket_delete',
  pageCreate: 'content_page_create',
  pageUpdate: 'content_page_update',
  pageDelete: 'content_page_delete',
  planUpdate: 'content_plan_update',
  changeStatus: 'content_change_status',
} as const;

/** OpenCode permission key covering every content tool (wildcard on the tool id). */
export const AGENSTRA_CONTENT_MCP_TOOL_PERMISSION = 'agenstra_content_*';

/**
 * Route segment below a context ticket (`/api/agent-context/tickets/:ticket/changes`): changes use the agent-token
 * authentication and the ticket binding of the context API unchanged.
 */
export const AGENSTRA_CONTENT_CHANGES_API_SEGMENT = 'changes';

/** Change operations (also the values of the `allowedContentWrites` opt-ins of tasks and ticket automation). */
export const AGENT_CONTENT_WRITE_OPERATIONS = [
  'ticket.create',
  'ticket.update',
  'ticket.comment',
  'ticket.delete',
  'page.create',
  'page.update',
  'page.delete',
  'plan.update',
] as const;

export type AgentContentWriteOperation = (typeof AGENT_CONTENT_WRITE_OPERATIONS)[number];

/** Operations ticket automation may be allowed: tickets of its own ticket tree only, never deletes. */
export const TICKET_AUTOMATION_CONTENT_WRITE_OPERATIONS = [
  'ticket.create',
  'ticket.update',
  'ticket.comment',
] as const satisfies readonly AgentContentWriteOperation[];

/** Change operation of each content tool (`content_change_status` has none). */
export const AGENT_CONTENT_TOOL_OPERATIONS: Record<string, AgentContentWriteOperation> = {
  [AGENSTRA_CONTENT_MCP_TOOL_NAMES.ticketCreate]: 'ticket.create',
  [AGENSTRA_CONTENT_MCP_TOOL_NAMES.ticketUpdate]: 'ticket.update',
  [AGENSTRA_CONTENT_MCP_TOOL_NAMES.ticketComment]: 'ticket.comment',
  [AGENSTRA_CONTENT_MCP_TOOL_NAMES.ticketDelete]: 'ticket.delete',
  [AGENSTRA_CONTENT_MCP_TOOL_NAMES.pageCreate]: 'page.create',
  [AGENSTRA_CONTENT_MCP_TOOL_NAMES.pageUpdate]: 'page.update',
  [AGENSTRA_CONTENT_MCP_TOOL_NAMES.pageDelete]: 'page.delete',
  [AGENSTRA_CONTENT_MCP_TOOL_NAMES.planUpdate]: 'plan.update',
};

/** Content tool of each change operation (tool-call matching, display). */
export function agentContentToolForOperation(operation: AgentContentWriteOperation): string {
  return Object.entries(AGENT_CONTENT_TOOL_OPERATIONS).find(([, op]) => op === operation)?.[0] as string;
}

/** Input bounds shared by the MCP server, the manager API and the controller (authoritative validation). */
export const AGENT_CONTENT_LIMITS = {
  titleMaxLength: 500,
  /** Plan titles (`chat_plan.summary`). */
  planTitleMaxLength: 512,
  contentMaxLength: 200_000,
  commentMaxLength: 32_000,
  reasonMaxLength: 500,
  /** Changes one context ticket (one turn) may request. */
  maxChangesPerTicket: 50,
} as const;

export const AGENT_CONTENT_TICKET_STATUSES = ['draft', 'todo', 'in_progress', 'prototype', 'done', 'closed'] as const;
export const AGENT_CONTENT_TICKET_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;

export type AgentContentTicketStatus = (typeof AGENT_CONTENT_TICKET_STATUSES)[number];
export type AgentContentTicketPriority = (typeof AGENT_CONTENT_TICKET_PRIORITIES)[number];

export function isAgentContentWriteOperation(value: unknown): value is AgentContentWriteOperation {
  return typeof value === 'string' && (AGENT_CONTENT_WRITE_OPERATIONS as readonly string[]).includes(value);
}

/** Deduplicated, known operations in canonical order (invalid entries are dropped). */
export function normalizeAgentContentWriteOperations(
  values: readonly unknown[] | undefined,
): AgentContentWriteOperation[] {
  const requested = new Set((values ?? []).filter(isAgentContentWriteOperation));

  return AGENT_CONTENT_WRITE_OPERATIONS.filter((operation) => requested.has(operation));
}

/**
 * One change as requested by the agent. `ref` / `parentRef` are context refs (`ticket:<sha>` / `knowledge:<sha>`);
 * `revision` is the one `context_get` returned for that element (changed elements are never overwritten blindly).
 */
export type AgentContentChangeInput =
  | {
      operation: 'ticket.create';
      parentRef?: string;
      title: string;
      content?: string;
      priority?: AgentContentTicketPriority;
      status?: AgentContentTicketStatus;
    }
  | {
      operation: 'ticket.update';
      ref: string;
      revision: string;
      title?: string;
      content?: string;
      priority?: AgentContentTicketPriority;
      status?: AgentContentTicketStatus;
    }
  | { operation: 'ticket.comment'; ref: string; body: string }
  | { operation: 'ticket.delete'; ref: string; revision: string }
  | { operation: 'page.create'; parentRef?: string; title: string; content?: string; nodeType?: 'page' | 'folder' }
  | { operation: 'page.update'; ref: string; revision: string; title?: string; content?: string }
  | { operation: 'page.delete'; ref: string; revision: string }
  /** Plans that never entered execution only (executed plans are read-only); `title` empty clears it. */
  | { operation: 'plan.update'; ref: string; revision: string; title?: string; content?: string };

export type AgentContentChangeRequest = AgentContentChangeInput & { reason?: string };

/**
 * - `applied`: the change was made (`ref` / `revision` describe the element afterwards)
 * - `pending`: waiting for the user; call `content_change_status` with `requestId`
 * - `denied`: rejected by the user or not allowed in this session
 * - `failed`: approved but the controller refused it (e.g. the element changed since `revision`)
 */
export type AgentContentChangeDecision = 'applied' | 'pending' | 'denied' | 'failed';

export interface AgentContentChangeResponse {
  requestId: string;
  decision: AgentContentChangeDecision;
  operation: AgentContentWriteOperation;
  ref?: string;
  title?: string;
  revision?: string;
  message?: string;
}

/**
 * Who asks the controller to apply a change (determined by the manager from the context ticket, never agent input).
 * The controller checks task / automation opt-ins against its own records.
 */
export type AgentContentChangeSource = { kind: 'chat' } | { kind: 'task'; taskId: string } | { kind: 'automation' };

/**
 * Change with refs resolved to full SHAs by the manager (`ref` / `parentRef` are `{ kind, sha }`), sent to the
 * controller over the context request socket (`op: 'change'`).
 */
export type AgentContentControllerChange =
  | (Omit<Extract<AgentContentChangeInput, { operation: 'ticket.create' }>, 'parentRef'> & { parentSha?: string })
  | (Omit<Extract<AgentContentChangeInput, { operation: 'ticket.update' }>, 'ref'> & { sha: string })
  | (Omit<Extract<AgentContentChangeInput, { operation: 'ticket.comment' }>, 'ref'> & { sha: string })
  | (Omit<Extract<AgentContentChangeInput, { operation: 'ticket.delete' }>, 'ref'> & { sha: string })
  | (Omit<Extract<AgentContentChangeInput, { operation: 'page.create' }>, 'parentRef'> & { parentSha?: string })
  | (Omit<Extract<AgentContentChangeInput, { operation: 'page.update' }>, 'ref'> & { sha: string })
  | (Omit<Extract<AgentContentChangeInput, { operation: 'page.delete' }>, 'ref'> & { sha: string })
  | (Omit<Extract<AgentContentChangeInput, { operation: 'plan.update' }>, 'ref'> & { sha: string });

/** Element after an applied change (`deleted` for deletes; comments report the ticket). */
export interface AgentContentChangeResult {
  kind: 'ticket' | 'knowledge' | 'plan';
  sha: string;
  title: string;
  revision?: string;
  deleted?: boolean;
}

/** True for OpenCode permission names / tool ids belonging to the content tools. */
export function isAgenstraContentToolPermission(permissionType: string | undefined): boolean {
  return typeof permissionType === 'string' && permissionType.trim().toLowerCase().startsWith('agenstra_content_');
}
