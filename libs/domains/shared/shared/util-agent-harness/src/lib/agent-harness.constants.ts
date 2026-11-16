/**
 * Constants of the Agenstra OpenAI-compatible API (`/api/clients/{clientId}/agents/{agentId}/openai/v1`) that a
 * harness must respect. They mirror the controller's limits (`CLIENT_TOOL_LIMITS` in the agenstra domain), so requests
 * that would be rejected server-side fail early and with a clear message on the client.
 */

/** Path of the OpenAI-compatible API below the controller's REST base URL (`…/api`). */
export const AGENT_HARNESS_OPENAI_PATH = 'openai/v1';

/** Request / response header selecting (and reporting) the chat session of a turn. */
export const AGENT_HARNESS_CHAT_ID_HEADER = 'X-Agenstra-Chat-Id';

/** Request header opting in to read-only agent tool activity (`mcp_call` items / `reasoning_content`). */
export const AGENT_HARNESS_TOOL_ACTIVITY_HEADER = 'X-Agenstra-Tool-Activity';

/** `model` value that keeps the agent's default model. */
export const AGENT_HARNESS_DEFAULT_MODEL = 'default';

/** Limits of client (function) tools per turn, identical to the controller's. */
export const AGENT_HARNESS_TOOL_LIMITS = {
  maxTools: 128,
  nameMaxLength: 64,
  descriptionMaxLength: 4096,
  /** Serialized JSON schema of one tool. */
  parametersMaxBytes: 16_384,
  /** Serialized definitions of all tools of a turn. */
  totalMaxBytes: 131_072,
  /** Client tool calls one turn may make. */
  maxCallsPerTurn: 64,
  /** Serialized arguments of one call. */
  argumentsMaxBytes: 65_536,
  /** Tool output handed back to the agent (the controller truncates longer output). */
  outputMaxChars: 100_000,
} as const;

/** Same pattern as OpenAI function names (and the controller's validation). */
export const AGENT_HARNESS_TOOL_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** JSON bodies on the OpenAI-compatible routes may be up to 1 MB. */
export const AGENT_HARNESS_MAX_BODY_BYTES = 1_000_000;

/** Upper bound of tool rounds (request → tool calls → results) of one turn; the controller caps calls at 64. */
export const AGENT_HARNESS_DEFAULT_MAX_TOOL_ROUNDS = 32;

/** Context sections are part of the turn prompt (stored in the chat transcript); keep them bounded. */
export const AGENT_HARNESS_CONTEXT_MAX_CHARS = 32_000;

/** Upper bound of one user message sent through the harness (well below the 1 MB body limit). */
export const AGENT_HARNESS_MESSAGE_MAX_CHARS = 200_000;

/** `conv_<32 hex>` conversation ids, `msg_<32 hex>` item ids. */
export const AGENT_HARNESS_CONVERSATION_ID_PATTERN = /^conv_[0-9a-f]{32}$/i;

export const AGENT_HARNESS_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Background drain of an aborted turn: rounds of cancelled tool results and overall time limit. */
export const AGENT_HARNESS_RELEASE_MAX_ROUNDS = 8;
export const AGENT_HARNESS_RELEASE_TIMEOUT_MS = 300_000;
