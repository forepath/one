/**
 * Agent handoffs: an agent hands a task to another agent of the **same workspace** through the platform
 * `agenstra` MCP server (`agenstra_handoff_*` tools). The controller opens a new, visible chat on the target
 * agent (chat session kind `handoff`), drives the target turn until it answered with `handoff_respond`
 * (repair prompts like chat plans) and posts the response back into the chat the handoff was made in.
 *
 * Handoffs are only accepted from a visible chat that is the only working context of the calling agent: hidden
 * sessions (task runs, ticket automation, plan / helper sessions) end before a response could arrive, and parallel
 * turns would make the requesting chat ambiguous. Responses never move to another chat.
 *
 * Both chat messages carry a machine-readable header so the console can render them as handoff cards that
 * link the affected agents / chats.
 */

/** OpenCode names MCP tools `<server>_<tool>`, so the agent sees `agenstra_handoff_*`. */
export const AGENSTRA_HANDOFF_MCP_TOOL_NAMES = {
  agents: 'handoff_agents',
  create: 'handoff_create',
  get: 'handoff_get',
  respond: 'handoff_respond',
  profileGet: 'handoff_profile_get',
  profileUpdate: 'handoff_profile_update',
} as const;

/** OpenCode permission key covering every handoff tool (wildcard on the tool id). */
export const AGENSTRA_HANDOFF_MCP_TOOL_PERMISSION = 'agenstra_handoff_*';

/** OpenCode tool id of `handoff_create` (permission / display). */
export const AGENSTRA_HANDOFF_CREATE_TOOL_ID = `agenstra_${AGENSTRA_HANDOFF_MCP_TOOL_NAMES.create}`;

/** OpenCode tool id of `handoff_respond` (referenced in prompts). */
export const AGENSTRA_HANDOFF_RESPOND_TOOL_ID = `agenstra_${AGENSTRA_HANDOFF_MCP_TOOL_NAMES.respond}`;

/**
 * Manager route segment below the agent context API route (`/api/agent-context/handoffs`), so the
 * agent-token authentication and the egress exception of the context API apply unchanged.
 */
export const AGENSTRA_HANDOFFS_API_SEGMENT = 'handoffs';

/** Socket.IO event (manager → controller, with ack) for every handoff operation of one agent. */
export const AGENT_HANDOFF_REQUEST_EVENT = 'agentHandoffRequest';

/** User-visible chat session kind of the chat a handoff opens on the target agent. */
export const AGENT_HANDOFF_CHAT_SESSION_KIND = 'handoff';

/** Input bounds shared by the MCP server, the manager API and the controller (authoritative validation). */
export const AGENT_HANDOFF_LIMITS = {
  titleMaxLength: 200,
  messageMaxLength: 20_000,
  responseMaxLength: 20_000,
  /** Handoff profile of an agent: its responsibilities and what it can take over. */
  profileMaxLength: 4_000,
} as const;

/**
 * - `pending`: created, target chat opened, waiting for the queue
 * - `running`: the target agent works on it
 * - `completed` / `failed`: answered (by the target or by the platform); the response is then delivered
 */
export type AgentHandoffStatus = 'pending' | 'running' | 'completed' | 'failed';

/** Outcome the target agent reports with `handoff_respond`. */
export type AgentHandoffResponseStatus = 'completed' | 'failed';

/**
 * Delivery of the outcome into the requesting chat:
 * - `pending`: not answered yet or delivery in progress / retried
 * - `delivered`: the requesting agent received the response
 * - `undeliverable`: the requesting chat no longer exists (or retries were exhausted); see `deliveryFailureMessage`
 */
export type AgentHandoffDeliveryStatus = 'pending' | 'delivered' | 'undeliverable';

export function isAgentHandoffResponseStatus(value: unknown): value is AgentHandoffResponseStatus {
  return value === 'completed' || value === 'failed';
}

/**
 * Another agent of the caller's workspace that can receive handoffs. `handoffProfile` is maintained in the console
 * and by the agent itself (`handoff_profile_update`); the other fields are the environment's metadata.
 */
export interface AgentHandoffAgentSummary {
  id: string;
  name: string;
  description?: string;
  handoffProfile?: string;
  containerType?: string;
  repositoryUrl?: string;
}

/** The calling agent itself, so it can see (and keep up to date) what its peers read about it. */
export interface AgentHandoffSelfSummary {
  id: string;
  name: string;
  description?: string;
  handoffProfile?: string;
}

export interface AgentHandoffSummary {
  id: string;
  sourceAgentId: string;
  sourceAgentName: string;
  /**
   * Where the handoff was made and the response is delivered (only there): a visible chat of the source agent, or a
   * run of one of its approved scheduled tasks (`sourceTaskId` / `sourceTaskRunId`; `sourceChatId` is then `null`).
   */
  sourceChatId: string | null;
  sourceTaskId: string | null;
  sourceTaskRunId: string | null;
  targetAgentId: string;
  targetAgentName: string;
  /** Chat opened on the target agent for this handoff. */
  targetChatId: string;
  title: string;
  message: string;
  status: AgentHandoffStatus;
  response: string | null;
  failureMessage: string | null;
  delivery: AgentHandoffDeliveryStatus;
  deliveryFailureMessage: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface AgentHandoffCreateInput {
  targetAgentId: string;
  title: string;
  /** Self-contained task description: the target starts in a new chat without the caller's history. */
  message: string;
  /** OpenCode `provider/model` for the target turn. Defaults to the model the target agent was last used with. */
  model?: string;
}

export interface AgentHandoffRespondInput {
  status: AgentHandoffResponseStatus;
  response: string;
}

export interface AgentHandoffAgentsResponse {
  self: AgentHandoffSelfSummary;
  agents: AgentHandoffAgentSummary[];
}

export interface AgentHandoffProfileInput {
  /** Empty string clears the profile. */
  profile: string;
}

export interface AgentHandoffResponse {
  handoff: AgentHandoffSummary;
}

/** Manager → controller request (Socket.IO ack). `agentId` is the authenticated agent of the MCP call. */
export type AgentHandoffControllerRequest =
  | { op: 'agents'; agentId: string }
  /**
   * The source is resolved by the manager from the calling agent's single working context (the MCP call itself
   * carries no session): `sourceChatId` for a visible chat, `sourceTaskId` for the hidden session of a task run (the
   * controller resolves the run and checks the task's approved targets). Exactly one of both is set.
   */
  | {
      op: 'create';
      agentId: string;
      sourceChatId?: string;
      sourceTaskId?: string;
      /** Model of the requesting chat: used for the turn that delivers the response there. */
      sourceModel?: string;
      input: AgentHandoffCreateInput;
    }
  | { op: 'get'; agentId: string; handoffId: string }
  | { op: 'respond'; agentId: string; handoffId: string; input: AgentHandoffRespondInput };

export type AgentHandoffControllerResponse =
  | { ok: true; agents?: AgentHandoffAgentSummary[]; handoff?: AgentHandoffSummary }
  /** `status` mirrors the HTTP status the controller would have answered with (400, 404, ...). */
  | { ok: false; error: string; status?: number };

// --- chat messages ---------------------------------------------------------------------------------------------

const REQUEST_TAG = 'agenstra-handoff';
const RESPONSE_TAG = 'agenstra-handoff-response';
const INSTRUCTIONS_TAG = 'agenstra-handoff-instructions';
const DATA_TAG = 'agenstra-handoff-data';

/** Header of the first user message in the target chat (incoming handoff). */
export interface AgentHandoffRequestMessageMeta {
  id: string;
  title: string;
  sourceAgentId: string;
  sourceAgentName: string;
  /** Chat the handoff was made in (`null` when it was made by a task run). */
  sourceChatId: string | null;
  /** Task run the handoff was made in (jump link to the run on the tasks page). */
  sourceTaskId?: string;
  sourceTaskRunId?: string;
}

/** Header of the user message in the source chat that delivers the answer (outgoing handoff answered). */
export interface AgentHandoffResponseMessageMeta {
  id: string;
  title: string;
  status: AgentHandoffResponseStatus;
  targetAgentId: string;
  targetAgentName: string;
  targetChatId: string;
}

export type ParsedAgentHandoffChatMessage =
  | { kind: 'request'; meta: AgentHandoffRequestMessageMeta; body: string }
  | { kind: 'response'; meta: AgentHandoffResponseMessageMeta; body: string };

/** JSON inside a tag must not be able to close it. */
function encodeMeta(meta: object): string {
  return JSON.stringify(meta).replace(/</g, '\\u003c');
}

/**
 * Peer-written text must not be able to open / close platform blocks (fake instructions, fake data end): every
 * `<agenstra-handoff…` / `</agenstra-handoff…` sequence is neutralized.
 */
export function neutralizeAgentHandoffText(text: string): string {
  return text.replace(/<(\/?)(agenstra-handoff)/gi, '&lt;$1$2');
}

function restoreAgentHandoffText(text: string): string {
  return text.replace(/&lt;(\/?)(agenstra-handoff)/gi, '<$1$2');
}

/** A value quoted for platform instruction text (single line, JSON-quoted, neutralized). */
export function quoteAgentHandoffValue(value: string): string {
  return neutralizeAgentHandoffText(JSON.stringify(value.replace(/[\r\n]+/g, ' ').trim()));
}

/**
 * Layout: header, the fixed platform instructions, then the peer-written text as clearly delimited data. The
 * instructions come first so nothing a peer writes can follow (and seem to extend) them.
 */
function buildMessage(tag: string, meta: object, body: string, instructions: string): string {
  return (
    `<${tag}>${encodeMeta(meta)}</${tag}>\n\n` +
    `<${INSTRUCTIONS_TAG}>\n${instructions.trim()}\n</${INSTRUCTIONS_TAG}>\n\n` +
    `<${DATA_TAG}>\n${neutralizeAgentHandoffText(body.trim())}\n</${DATA_TAG}>`
  );
}

/** First user message of the handoff chat on the target agent. `instructions` are hidden in the console card. */
export function buildAgentHandoffRequestMessage(
  meta: AgentHandoffRequestMessageMeta,
  body: string,
  instructions: string,
): string {
  return buildMessage(REQUEST_TAG, meta, body, instructions);
}

/** User message that delivers the answer into the source chat. */
export function buildAgentHandoffResponseMessage(
  meta: AgentHandoffResponseMessageMeta,
  body: string,
  instructions: string,
): string {
  return buildMessage(RESPONSE_TAG, meta, body, instructions);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function parseRequestMeta(raw: Record<string, unknown>): AgentHandoffRequestMessageMeta | undefined {
  const id = asString(raw['id']);
  const sourceAgentId = asString(raw['sourceAgentId']);
  const sourceChatId = asString(raw['sourceChatId']);
  const sourceTaskId = asString(raw['sourceTaskId']);
  const sourceTaskRunId = asString(raw['sourceTaskRunId']);

  if (!id || !sourceAgentId || (!sourceChatId && !(sourceTaskId && sourceTaskRunId))) {
    return undefined;
  }

  return {
    id,
    title: asString(raw['title']) ?? '',
    sourceAgentId,
    sourceAgentName: asString(raw['sourceAgentName']) ?? '',
    sourceChatId: sourceChatId ?? null,
    ...(!sourceChatId && sourceTaskId && sourceTaskRunId ? { sourceTaskId, sourceTaskRunId } : {}),
  };
}

function parseResponseMeta(raw: Record<string, unknown>): AgentHandoffResponseMessageMeta | undefined {
  const id = asString(raw['id']);
  const targetAgentId = asString(raw['targetAgentId']);
  const targetChatId = asString(raw['targetChatId']);

  if (!id || !targetAgentId || !targetChatId) {
    return undefined;
  }

  return {
    id,
    title: asString(raw['title']) ?? '',
    status: isAgentHandoffResponseStatus(raw['status']) ? raw['status'] : 'completed',
    targetAgentId,
    targetAgentName: asString(raw['targetAgentName']) ?? '',
    targetChatId,
  };
}

/**
 * Recognize handoff chat messages (request in the target chat, response in the source chat). Returns the header
 * and the visible body without the agent instructions; `undefined` for every other message.
 */
export function parseAgentHandoffChatMessage(
  text: string | null | undefined,
): ParsedAgentHandoffChatMessage | undefined {
  const trimmed = typeof text === 'string' ? text.trimStart() : '';
  const header = /^<(agenstra-handoff(?:-response)?)>([\s\S]*?)<\/\1>/.exec(trimmed);

  if (!header) {
    return undefined;
  }

  let raw: unknown;

  try {
    raw = JSON.parse(header[2] ?? '');
  } catch {
    return undefined;
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }

  const rest = trimmed.slice(header[0].length);
  const dataStart = rest.indexOf(`<${DATA_TAG}>`);
  const dataEnd = rest.lastIndexOf(`</${DATA_TAG}>`);
  let body: string;

  if (dataStart >= 0 && dataEnd > dataStart) {
    body = restoreAgentHandoffText(rest.slice(dataStart + DATA_TAG.length + 2, dataEnd));
  } else {
    // Earlier layout: body first, instructions last.
    const instructionsStart = rest.lastIndexOf(`<${INSTRUCTIONS_TAG}>`);

    body = instructionsStart >= 0 ? rest.slice(0, instructionsStart) : rest;
  }

  body = body.trim();

  if (header[1] === REQUEST_TAG) {
    const meta = parseRequestMeta(raw as Record<string, unknown>);

    return meta ? { kind: 'request', meta, body } : undefined;
  }

  const meta = parseResponseMeta(raw as Record<string, unknown>);

  return meta ? { kind: 'response', meta, body } : undefined;
}
