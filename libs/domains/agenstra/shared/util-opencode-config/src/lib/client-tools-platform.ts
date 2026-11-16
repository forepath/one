import { AGENSTRA_CONTEXT_MCP_SERVER_KEY } from './context-platform';

/**
 * Client tools: OpenAI-compatible function calling for agent chat turns.
 *
 * An API client (OpenAI SDK, harness) passes function tools with a turn of the OpenAI-compatible API. The agent calls
 * them through the platform `agenstra` MCP server (`agenstra_client_tools_*`); the agent-manager forwards each call to
 * the controller connection that started the turn, which hands it to the API client as standard `tool_calls` /
 * `function_call` output. The client runs the tool and returns the result with its next request; the agent's turn
 * continues with it. Client tools only exist for the turn they were passed with (context ticket).
 */

/** OpenCode names MCP tools `<server>_<tool>`, so the agent sees `agenstra_client_tools_*`. */
export const AGENSTRA_CLIENT_TOOLS_MCP_TOOL_NAMES = {
  call: 'client_tools_call',
  result: 'client_tools_result',
} as const;

/** OpenCode permission key covering the client tool bridge (wildcard on the tool id). */
export const AGENSTRA_CLIENT_TOOLS_MCP_TOOL_PERMISSION = `${AGENSTRA_CONTEXT_MCP_SERVER_KEY}_client_tools_*`;

/** Manager route segment below the agent context API route (`/api/agent-context/client-tools`). */
export const AGENSTRA_CLIENT_TOOLS_API_SEGMENT = 'client-tools';

/** Socket.IO event (manager → controller, with ack) carrying client tool calls of a turn. */
export const AGENT_CLIENT_TOOL_REQUEST_EVENT = 'agentClientToolRequest';

/** Limits of client tool definitions and calls (per turn). */
export const CLIENT_TOOL_LIMITS = {
  /** Same as OpenAI's tool limit. */
  maxTools: 128,
  nameMaxLength: 64,
  descriptionMaxLength: 4096,
  /** Serialized JSON schema of one tool. */
  parametersMaxBytes: 16_384,
  /** Serialized definitions of all tools of a turn (they are part of the agent prompt). */
  totalMaxBytes: 131_072,
  /** Client tool calls one turn may make. */
  maxCallsPerTurn: 64,
  /** Serialized arguments of one call. */
  argumentsMaxBytes: 65_536,
  /** Client output handed to the agent (longer output is truncated). */
  outputMaxChars: 100_000,
} as const;

/**
 * One wait of the agent for a client result (manager → controller ack). Longer waits answer `pending` and the agent
 * keeps waiting with `agenstra_client_tools_result`, so MCP / HTTP time limits never cut a call.
 */
export const CLIENT_TOOL_WAIT_MS = 40_000;

/** Same pattern as OpenAI function names. */
export const CLIENT_TOOL_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Prefix of call ids (OpenAI `tool_call.id` / `call_id`); random, minted by the agent-manager. */
export const CLIENT_TOOL_CALL_ID_PATTERN = /^call_[A-Za-z0-9]{24,64}$/;

export interface ClientToolDefinition {
  name: string;
  description?: string;
  /** JSON schema of the arguments object. */
  parameters?: Record<string, unknown>;
  strict?: boolean;
}

/** `auto`: the agent decides; `required`: at least one call; `{ name }`: that tool must be called. */
export type ClientToolChoice = 'auto' | 'required' | { name: string };

/** Manager → controller (ack): a new client tool call, or another wait for a pending one. */
export type AgentClientToolRequest =
  | {
      op: 'call';
      agentId: string;
      chatId?: string;
      correlationId: string;
      callId: string;
      name: string;
      /** JSON-serialized arguments object. */
      arguments: string;
    }
  | { op: 'wait'; agentId: string; correlationId: string; callId: string };

/** Controller → manager (ack payload). */
export type AgentClientToolResponse =
  | { ok: true; status: 'completed'; output: string }
  | { ok: true; status: 'pending' }
  | { ok: true; status: 'failed'; error: string }
  | { ok: false; error: string };

/** Agent-facing result of `agenstra_client_tools_call` / `agenstra_client_tools_result`. */
export interface AgentClientToolCallResponse {
  callId: string;
  status: 'completed' | 'pending' | 'failed';
  output?: string;
  error?: string;
}

export class ClientToolsValidationError extends Error {
  constructor(
    message: string,
    readonly param: string,
  ) {
    super(message);
    this.name = 'ClientToolsValidationError';
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value) ?? '').length;
}

/**
 * Validate client tool definitions (already in the flat `{ name, description, parameters, strict }` shape).
 * Throws {@link ClientToolsValidationError} naming the offending parameter.
 */
export function normalizeClientTools(raw: unknown, param = 'tools'): ClientToolDefinition[] {
  if (!Array.isArray(raw)) {
    throw new ClientToolsValidationError(`${param} must be an array`, param);
  }

  if (raw.length > CLIENT_TOOL_LIMITS.maxTools) {
    throw new ClientToolsValidationError(`${param} supports at most ${CLIENT_TOOL_LIMITS.maxTools} tools`, param);
  }

  const seen = new Set<string>();
  const tools = raw.map((entry, index) => {
    const entryParam = `${param}[${index}]`;

    if (!isPlainObject(entry)) {
      throw new ClientToolsValidationError(`${entryParam} must be an object`, entryParam);
    }

    const name = entry['name'];

    if (typeof name !== 'string' || !CLIENT_TOOL_NAME_PATTERN.test(name)) {
      throw new ClientToolsValidationError(`${entryParam}.name must match ^[a-zA-Z0-9_-]{1,64}$`, `${entryParam}.name`);
    }

    if (seen.has(name)) {
      throw new ClientToolsValidationError(`Duplicate tool name '${name}'`, `${entryParam}.name`);
    }

    seen.add(name);
    const description = entry['description'];

    if (
      description !== undefined &&
      description !== null &&
      (typeof description !== 'string' || description.length > CLIENT_TOOL_LIMITS.descriptionMaxLength)
    ) {
      throw new ClientToolsValidationError(
        `${entryParam}.description must be a string of at most ${CLIENT_TOOL_LIMITS.descriptionMaxLength} characters`,
        `${entryParam}.description`,
      );
    }

    const parameters = entry['parameters'];

    if (parameters !== undefined && parameters !== null) {
      if (!isPlainObject(parameters)) {
        throw new ClientToolsValidationError(
          `${entryParam}.parameters must be a JSON schema object`,
          `${entryParam}.parameters`,
        );
      }

      if (byteLength(parameters) > CLIENT_TOOL_LIMITS.parametersMaxBytes) {
        throw new ClientToolsValidationError(
          `${entryParam}.parameters must be at most ${CLIENT_TOOL_LIMITS.parametersMaxBytes} bytes`,
          `${entryParam}.parameters`,
        );
      }
    }

    const strict = entry['strict'];

    return {
      name,
      ...(typeof description === 'string' && description ? { description } : {}),
      ...(isPlainObject(parameters) ? { parameters } : {}),
      ...(typeof strict === 'boolean' ? { strict } : {}),
    } satisfies ClientToolDefinition;
  });

  if (byteLength(tools) > CLIENT_TOOL_LIMITS.totalMaxBytes) {
    throw new ClientToolsValidationError(
      `${param} must be at most ${CLIENT_TOOL_LIMITS.totalMaxBytes} bytes in total`,
      param,
    );
  }

  return tools;
}

/** Validate a tool choice against the offered tools (named choices must name one of them). */
export function normalizeClientToolChoice(raw: unknown, tools: ClientToolDefinition[]): ClientToolChoice {
  if (raw === undefined || raw === null || raw === 'auto') {
    return 'auto';
  }

  if (raw === 'required') {
    return 'required';
  }

  if (isPlainObject(raw) && typeof raw['name'] === 'string') {
    const name = raw['name'];

    if (!tools.some((tool) => tool.name === name)) {
      throw new ClientToolsValidationError(`tool_choice names unknown tool '${name}'`, 'tool_choice');
    }

    return { name };
  }

  throw new ClientToolsValidationError("tool_choice must be 'auto', 'required' or a named tool", 'tool_choice');
}

/** Serialize call arguments (MCP input is an object; OpenAI hands clients a JSON string). */
export function serializeClientToolArguments(raw: unknown): string {
  if (typeof raw === 'string') {
    const trimmed = raw.trim();

    if (!trimmed) {
      return '{}';
    }

    try {
      const parsed = JSON.parse(trimmed) as unknown;

      if (!isPlainObject(parsed)) {
        throw new ClientToolsValidationError('arguments must be a JSON object', 'arguments');
      }

      return JSON.stringify(parsed);
    } catch (error) {
      if (error instanceof ClientToolsValidationError) {
        throw error;
      }

      throw new ClientToolsValidationError('arguments must be a JSON object', 'arguments');
    }
  }

  if (raw === undefined || raw === null) {
    return '{}';
  }

  if (!isPlainObject(raw)) {
    throw new ClientToolsValidationError('arguments must be a JSON object', 'arguments');
  }

  return JSON.stringify(raw);
}

/**
 * Prompt section describing the client tools of a turn (agent-facing). The ticket binds calls to this turn; tool
 * definitions are client input and are presented as such.
 */
export function buildClientToolsPromptSection(
  ticket: string,
  tools: ClientToolDefinition[],
  options: { choice?: ClientToolChoice; parallel?: boolean } = {},
): string {
  const call = `${AGENSTRA_CONTEXT_MCP_SERVER_KEY}_${AGENSTRA_CLIENT_TOOLS_MCP_TOOL_NAMES.call}`;
  const result = `${AGENSTRA_CONTEXT_MCP_SERVER_KEY}_${AGENSTRA_CLIENT_TOOLS_MCP_TOOL_NAMES.result}`;
  const lines = [
    '<client_tools>',
    'The API client of this chat provides the tools below. They run on the client side (not in your workspace) and',
    `are only available for this request. Call one with the \`${call}\` tool (ticket: "${ticket}", name: tool name,`,
    "arguments: JSON object matching its parameters). The tool returns the client's output. When it reports",
    `status "pending", call \`${result}\` with the same ticket and the callId until it completes.`,
    'Use your own tools for work in your workspace; use client tools for what only the client can do.',
  ];

  if (options.parallel === false) {
    lines.push('Call at most one client tool at a time.');
  }

  if (options.choice === 'required') {
    lines.push('You must call at least one client tool before you answer.');
  } else if (options.choice && typeof options.choice === 'object') {
    lines.push(`You must call the client tool "${options.choice.name}" before you answer.`);
  }

  lines.push('Tools (client-provided definitions):');

  for (const tool of tools) {
    lines.push(`- ${tool.name}${tool.description ? `: ${tool.description.replace(/\s+/g, ' ').trim()}` : ''}`);
    lines.push(`  parameters: ${JSON.stringify(tool.parameters ?? { type: 'object', properties: {} })}`);
  }

  lines.push('</client_tools>');

  return lines.join('\n');
}
