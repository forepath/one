import {
  ClientToolsValidationError,
  normalizeClientToolChoice,
  normalizeClientTools,
  type ClientToolChoice,
  type ClientToolDefinition,
} from '@forepath/agenstra/shared/util-opencode-config';

import { OpenAiApiError } from './openai-compatible-errors';

/**
 * Request parsing for the OpenAI-compatible API.
 *
 * OpenAI's Chat Completions API is stateless (callers resend the whole history), Agenstra chat sessions are stateful
 * (the agent keeps the transcript). Only the new turn is therefore sent to the agent: every message after the last
 * `assistant` message. Bodies are validated by hand (not with the global DTO whitelist) so the many optional OpenAI
 * fields that have no Agenstra equivalent are accepted and ignored instead of failing the request.
 */

/** Header selecting the chat session (also returned on every turn response). */
export const OPENAI_CHAT_ID_HEADER = 'x-agenstra-chat-id';

/** Header opting in to read-only agent tool activity (`true` / `1`); body extension: `tool_activity: true`. */
export const OPENAI_TOOL_ACTIVITY_HEADER = 'x-agenstra-tool-activity';

/** `model` value that keeps the agent's default model. */
export const OPENAI_DEFAULT_MODEL_ID = 'default';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX_32 = /^[0-9a-f]{32}$/i;
const MAX_MODEL_LENGTH = 256;
const MAX_METADATA_ENTRIES = 16;
const MAX_METADATA_KEY_LENGTH = 64;
const MAX_METADATA_VALUE_LENGTH = 512;

export type OpenAiMetadata = Record<string, string>;

export interface ParsedChatCompletionRequest {
  model: string;
  prompt: string;
  stream: boolean;
  includeUsage: boolean;
  /** Explicitly selected chat session (header or `chat_id`); undefined: primary session. */
  chatId?: string;
  metadata: OpenAiMetadata | null;
  /** Opt-in: report the agent's own tool calls as `reasoning_content` (read-only). */
  toolActivity: boolean;
  /** Function tools the agent may call (undefined: none offered, incl. `tool_choice: "none"`). */
  clientTools?: ClientToolDefinition[];
  toolChoice: ClientToolChoice;
  parallelToolCalls: boolean;
  /** Tool results of the client after the last assistant message (continue a paused turn). */
  toolResults: ParsedToolResult[];
  /** Deprecated `functions` / `function_call` interface (one call at a time, `function_call` replies). */
  legacyFunctions: boolean;
}

export interface ParsedResponsesRequest {
  model: string;
  prompt: string;
  stream: boolean;
  /** Explicitly selected chat session (`conversation`, `previous_response_id`, header or `chat_id`). */
  chatId?: string;
  /** True when the caller used the `conversation` parameter (echoed on the response object). */
  conversationRequested: boolean;
  previousResponseId: string | null;
  instructions: string | null;
  metadata: OpenAiMetadata | null;
  /** Opt-in: report the agent's own tool calls as `mcp_call` output items (read-only). */
  toolActivity: boolean;
  /** Function tools the agent may call (undefined: none offered, incl. `tool_choice: "none"`). */
  clientTools?: ClientToolDefinition[];
  toolChoice: ClientToolChoice;
  parallelToolCalls: boolean;
  /** Tool results of the client after the last assistant message (continue a paused turn). */
  toolResults: ParsedToolResult[];
}

/** A client tool result: `callId` (tool_call_id / call_id), or `name` for legacy `function` messages. */
export interface ParsedToolResult {
  callId?: string;
  name?: string;
  output: string;
}

export interface ParsedConversationCreateRequest {
  title?: string;
  metadata: OpenAiMetadata | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function isUuidV4(value: string): boolean {
  return UUID_V4.test(value);
}

function hexToUuid(hex: string): string {
  const lower = hex.toLowerCase();

  return `${lower.slice(0, 8)}-${lower.slice(8, 12)}-${lower.slice(12, 16)}-${lower.slice(16, 20)}-${lower.slice(20)}`;
}

function uuidToHex(uuid: string): string {
  return uuid.replace(/-/g, '').toLowerCase();
}

/** `conv_<32 hex>` id of a chat session. */
export function toConversationId(chatId: string): string {
  return `conv_${uuidToHex(chatId)}`;
}

/** `msg_<32 hex>` id of a persisted chat message. */
export function toItemId(messageId: string): string {
  return `msg_${uuidToHex(messageId)}`;
}

/**
 * Chat session id of a `conv_…` id or a bare UUID. Returns undefined for anything else (never a partial match).
 */
export function parseConversationId(value: string): string | undefined {
  const trimmed = value.trim();

  if (isUuidV4(trimmed)) {
    return trimmed.toLowerCase();
  }

  if (trimmed.startsWith('conv_') && HEX_32.test(trimmed.slice(5))) {
    const uuid = hexToUuid(trimmed.slice(5));

    return isUuidV4(uuid) ? uuid : undefined;
  }

  return undefined;
}

/** Message id of a `msg_…` item id or a bare UUID. */
export function parseItemId(value: string): string | undefined {
  const trimmed = value.trim();

  if (isUuidV4(trimmed)) {
    return trimmed.toLowerCase();
  }

  if (trimmed.startsWith('msg_') && HEX_32.test(trimmed.slice(4))) {
    const uuid = hexToUuid(trimmed.slice(4));

    return isUuidV4(uuid) ? uuid : undefined;
  }

  return undefined;
}

/**
 * Response ids embed the chat session (`resp_<chat hex><random hex>`), so `previous_response_id` continues the same
 * chat without server-side response storage. The embedded chat is authorized like an explicit chat id.
 */
export function toResponseId(chatId: string, randomHex: string): string {
  return `resp_${uuidToHex(chatId)}${randomHex}`;
}

export function parseResponseId(value: string): string | undefined {
  const trimmed = value.trim();

  if (!trimmed.startsWith('resp_')) {
    return undefined;
  }

  const body = trimmed.slice(5);

  if (body.length < 32 || !/^[0-9a-f]+$/i.test(body)) {
    return undefined;
  }

  const uuid = hexToUuid(body.slice(0, 32));

  return isUuidV4(uuid) ? uuid : undefined;
}

function requireBody(body: unknown): Record<string, unknown> {
  if (!isRecord(body)) {
    throw OpenAiApiError.invalidRequest('Request body must be a JSON object.');
  }

  return body;
}

function parseModel(body: Record<string, unknown>): string {
  const model = body['model'];

  if (typeof model !== 'string' || !model.trim()) {
    throw OpenAiApiError.invalidRequest('you must provide a model parameter', 'model', 'missing_required_parameter');
  }

  if (model.length > MAX_MODEL_LENGTH) {
    throw OpenAiApiError.invalidRequest('model is too long', 'model');
  }

  return model.trim();
}

function parseOptionalBoolean(body: Record<string, unknown>, key: string): boolean {
  const value = body[key];

  if (value === undefined || value === null) {
    return false;
  }

  if (typeof value !== 'boolean') {
    throw OpenAiApiError.invalidRequest(`${key} must be a boolean`, key);
  }

  return value;
}

export function parseMetadata(value: unknown, param = 'metadata'): OpenAiMetadata | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (!isRecord(value)) {
    throw OpenAiApiError.invalidRequest(`${param} must be an object`, param);
  }

  const entries = Object.entries(value);

  if (entries.length > MAX_METADATA_ENTRIES) {
    throw OpenAiApiError.invalidRequest(`${param} supports at most ${MAX_METADATA_ENTRIES} keys`, param);
  }

  const metadata: OpenAiMetadata = {};

  for (const [key, entry] of entries) {
    if (key.length > MAX_METADATA_KEY_LENGTH) {
      throw OpenAiApiError.invalidRequest(`${param} keys must be at most ${MAX_METADATA_KEY_LENGTH} characters`, param);
    }

    if (typeof entry !== 'string' || entry.length > MAX_METADATA_VALUE_LENGTH) {
      throw OpenAiApiError.invalidRequest(
        `${param} values must be strings of at most ${MAX_METADATA_VALUE_LENGTH} characters`,
        param,
      );
    }

    metadata[key] = entry;
  }

  return metadata;
}

/** Opt-in to read-only tool activity via `X-Agenstra-Tool-Activity` or the `tool_activity` body extension. */
function parseToolActivity(body: Record<string, unknown>, headerValue: string | undefined): boolean {
  const value = body['tool_activity'];

  if (value !== undefined && value !== null && typeof value !== 'boolean') {
    throw OpenAiApiError.invalidRequest('tool_activity must be a boolean', 'tool_activity');
  }

  const header = typeof headerValue === 'string' ? headerValue.trim().toLowerCase() : '';

  return value === true || header === 'true' || header === '1';
}

function assertSingleChoice(body: Record<string, unknown>): void {
  const n = body['n'];

  if (n !== undefined && n !== null && n !== 1) {
    throw OpenAiApiError.unsupported('Only n=1 is supported: an agent answers each turn once.', 'n');
  }
}

/**
 * Chat session explicitly selected by the `X-Agenstra-Chat-Id` header and / or the `chat_id` body field.
 * Conflicting values are rejected rather than silently picking one.
 */
function resolveExplicitChatId(body: Record<string, unknown>, headerValue: string | undefined): string | undefined {
  const candidates: Array<{ value: string; param: string }> = [];

  if (typeof headerValue === 'string' && headerValue.trim()) {
    candidates.push({ value: headerValue, param: 'X-Agenstra-Chat-Id' });
  }

  const bodyValue = body['chat_id'];

  if (bodyValue !== undefined && bodyValue !== null) {
    if (typeof bodyValue !== 'string') {
      throw OpenAiApiError.invalidRequest('chat_id must be a string', 'chat_id');
    }

    candidates.push({ value: bodyValue, param: 'chat_id' });
  }

  return mergeChatIdCandidates(candidates);
}

function mergeChatIdCandidates(candidates: Array<{ value: string; param: string }>): string | undefined {
  let resolved: string | undefined;

  for (const candidate of candidates) {
    const chatId = parseConversationId(candidate.value);

    if (!chatId) {
      throw OpenAiApiError.invalidRequest(
        `${candidate.param} must be a chat session id (UUID or conv_…)`,
        candidate.param,
      );
    }

    if (resolved && resolved !== chatId) {
      throw OpenAiApiError.invalidRequest(
        'Conflicting chat sessions selected; use one of X-Agenstra-Chat-Id, chat_id, conversation or previous_response_id.',
        candidate.param,
      );
    }

    resolved = chatId;
  }

  return resolved;
}

type TurnRole = 'system' | 'developer' | 'user' | 'assistant';

interface TurnMessage {
  role: TurnRole;
  text: string;
}

const TEXT_PART_TYPES = new Set(['text', 'input_text', 'output_text']);

function extractContentText(content: unknown, param: string): string {
  if (typeof content === 'string') {
    return content;
  }

  if (content === null || content === undefined) {
    return '';
  }

  if (!Array.isArray(content)) {
    throw OpenAiApiError.invalidRequest(`${param} must be a string or an array of content parts`, param);
  }

  const texts: string[] = [];

  content.forEach((part, index) => {
    const partParam = `${param}[${index}]`;

    if (!isRecord(part)) {
      throw OpenAiApiError.invalidRequest(`${partParam} must be an object`, partParam);
    }

    const type = String(part['type'] ?? '');

    if (TEXT_PART_TYPES.has(type)) {
      if (typeof part['text'] !== 'string') {
        throw OpenAiApiError.invalidRequest(`${partParam}.text must be a string`, `${partParam}.text`);
      }

      texts.push(part['text']);

      return;
    }

    if (type === 'refusal') {
      return;
    }

    throw OpenAiApiError.unsupported(
      `Content part type '${type || 'unknown'}' is not supported; only text content can be sent to an agent.`,
      `${partParam}.type`,
    );
  });

  return texts.join('\n');
}

type TurnEntry = TurnMessage | { role: 'tool'; result?: ParsedToolResult };

/**
 * The new turn: messages after the last assistant message. Text of system / developer / user messages becomes the
 * prompt (joined in order); client tool results continue a paused turn. Tool results and other non-message items of
 * earlier history are ignored (the agent keeps its own transcript).
 */
function buildTurn(messages: TurnEntry[], param: string): { prompt: string; toolResults: ParsedToolResult[] } {
  let lastAssistant = -1;

  messages.forEach((message, index) => {
    if (message.role === 'assistant') {
      lastAssistant = index;
    }
  });

  const tail = messages.slice(lastAssistant + 1);
  const toolResults = tail.flatMap((entry) => (entry.role === 'tool' && entry.result ? [entry.result] : []));
  const turn = tail.filter((entry): entry is TurnMessage => entry.role !== 'tool');

  if (toolResults.length === 0 && !turn.some((message) => message.role === 'user')) {
    throw OpenAiApiError.invalidRequest(
      'The request must end with at least one user message (or tool results) after the last assistant message.',
      param,
    );
  }

  const prompt = turn
    .map((message) => message.text.trim())
    .filter((text) => text.length > 0)
    .join('\n\n');

  if (!prompt && toolResults.length === 0) {
    throw OpenAiApiError.invalidRequest('The new user message must not be empty.', param);
  }

  return { prompt, toolResults };
}

function toolsError(error: unknown, fallbackParam: string): never {
  if (error instanceof ClientToolsValidationError) {
    throw OpenAiApiError.invalidRequest(error.message, error.param || fallbackParam);
  }

  throw error;
}

function parseParallelToolCalls(body: Record<string, unknown>): boolean {
  const value = body['parallel_tool_calls'];

  if (value === undefined || value === null) {
    return true;
  }

  if (typeof value !== 'boolean') {
    throw OpenAiApiError.invalidRequest('parallel_tool_calls must be a boolean', 'parallel_tool_calls');
  }

  return value;
}

interface ToolOffer {
  clientTools?: ClientToolDefinition[];
  toolChoice: ClientToolChoice;
}

/**
 * Resolve offered tools and the tool choice: `none` offers nothing, `allowed_tools` narrows the offer, a forced choice
 * needs function tools. Hosted / custom tool types have no Agenstra equivalent and are ignored (harness compatibility).
 */
function resolveToolOffer(
  tools: ClientToolDefinition[],
  rawChoice: unknown,
  namedChoice: (choice: Record<string, unknown>) => string | undefined,
  allowed: (choice: Record<string, unknown>) => { mode: unknown; names: string[] } | undefined,
): ToolOffer {
  if (rawChoice === 'none') {
    return { toolChoice: 'auto' };
  }

  let offered = tools;
  let choice: unknown = rawChoice;

  if (isRecord(rawChoice)) {
    const allowedTools = allowed(rawChoice);

    if (allowedTools) {
      offered = tools.filter((tool) => allowedTools.names.includes(tool.name));
      choice = allowedTools.mode === 'required' ? 'required' : 'auto';
    } else {
      const name = namedChoice(rawChoice);

      if (name === undefined) {
        throw OpenAiApiError.unsupported(
          'Only function tools can be chosen: the agent uses its own built-in tools.',
          'tool_choice',
        );
      }

      choice = { name };
    }
  }

  if (offered.length === 0) {
    if (choice !== undefined && choice !== null && choice !== 'auto') {
      throw OpenAiApiError.invalidRequest('tool_choice requires function tools', 'tool_choice');
    }

    return { toolChoice: 'auto' };
  }

  try {
    return { clientTools: offered, toolChoice: normalizeClientToolChoice(choice, offered) };
  } catch (error) {
    return toolsError(error, 'tool_choice');
  }
}

/** Chat Completions `tools` (function tools) or the deprecated `functions`. */
function parseChatToolOffer(body: Record<string, unknown>): ToolOffer & { legacyFunctions: boolean } {
  const rawTools = body['tools'];
  const rawFunctions = body['functions'];

  if (rawFunctions !== undefined && rawFunctions !== null) {
    if (rawTools !== undefined && rawTools !== null) {
      throw OpenAiApiError.invalidRequest('Use either tools or the deprecated functions, not both.', 'functions');
    }

    if (!Array.isArray(rawFunctions)) {
      throw OpenAiApiError.invalidRequest('functions must be an array', 'functions');
    }

    let tools: ClientToolDefinition[];

    try {
      tools = normalizeClientTools(rawFunctions, 'functions');
    } catch (error) {
      return toolsError(error, 'functions');
    }

    const offer = resolveToolOffer(
      tools,
      body['function_call'],
      (choice) => (typeof choice['name'] === 'string' ? choice['name'] : undefined),
      () => undefined,
    );

    return { ...offer, legacyFunctions: true };
  }

  if (rawTools !== undefined && rawTools !== null && !Array.isArray(rawTools)) {
    throw OpenAiApiError.invalidRequest('tools must be an array', 'tools');
  }

  const functionTools = (Array.isArray(rawTools) ? rawTools : []).flatMap((tool, index) => {
    if (!isRecord(tool)) {
      throw OpenAiApiError.invalidRequest(`tools[${index}] must be an object`, `tools[${index}]`);
    }

    if (tool['type'] !== 'function') {
      return [];
    }

    if (!isRecord(tool['function'])) {
      throw OpenAiApiError.invalidRequest(`tools[${index}].function must be an object`, `tools[${index}].function`);
    }

    return [tool['function']];
  });
  let tools: ClientToolDefinition[];

  try {
    tools = normalizeClientTools(functionTools, 'tools');
  } catch (error) {
    return toolsError(error, 'tools');
  }

  const offer = resolveToolOffer(
    tools,
    body['tool_choice'],
    (choice) =>
      choice['type'] === 'function' && isRecord(choice['function']) && typeof choice['function']['name'] === 'string'
        ? choice['function']['name']
        : undefined,
    (choice) => {
      const allowed = choice['allowed_tools'];

      if (choice['type'] !== 'allowed_tools' || !isRecord(allowed) || !Array.isArray(allowed['tools'])) {
        return undefined;
      }

      return {
        mode: allowed['mode'],
        names: allowed['tools'].flatMap((entry) =>
          isRecord(entry) && isRecord(entry['function']) && typeof entry['function']['name'] === 'string'
            ? [entry['function']['name']]
            : [],
        ),
      };
    },
  );

  return { ...offer, legacyFunctions: false };
}

/** Responses API `tools` (function tools; hosted tools are ignored). */
function parseResponsesToolOffer(body: Record<string, unknown>): ToolOffer {
  const rawTools = body['tools'];

  if (rawTools !== undefined && rawTools !== null && !Array.isArray(rawTools)) {
    throw OpenAiApiError.invalidRequest('tools must be an array', 'tools');
  }

  const functionTools = (Array.isArray(rawTools) ? rawTools : []).filter(
    (tool) => isRecord(tool) && tool['type'] === 'function',
  );
  let tools: ClientToolDefinition[];

  try {
    tools = normalizeClientTools(functionTools, 'tools');
  } catch (error) {
    return toolsError(error, 'tools');
  }

  return resolveToolOffer(
    tools,
    body['tool_choice'],
    (choice) => (choice['type'] === 'function' && typeof choice['name'] === 'string' ? choice['name'] : undefined),
    (choice) =>
      choice['type'] === 'allowed_tools' && Array.isArray(choice['tools'])
        ? {
            mode: choice['mode'],
            names: choice['tools'].flatMap((entry) =>
              isRecord(entry) && entry['type'] === 'function' && typeof entry['name'] === 'string'
                ? [entry['name']]
                : [],
            ),
          }
        : undefined,
  );
}

/** Text of a tool result (`content` / `output`: string or text parts). */
function toolOutputText(value: unknown, param: string): string {
  if (typeof value === 'string') {
    return value;
  }

  if (value === undefined || value === null) {
    return '';
  }

  if (Array.isArray(value)) {
    return extractContentText(value, param);
  }

  return JSON.stringify(value);
}

const CHAT_ROLES = new Set(['system', 'developer', 'user', 'assistant']);

export function parseChatCompletionRequest(
  rawBody: unknown,
  chatIdHeader: string | undefined,
  toolActivityHeader?: string,
): ParsedChatCompletionRequest {
  const body = requireBody(rawBody);
  const model = parseModel(body);
  const messages = body['messages'];

  if (!Array.isArray(messages) || messages.length === 0) {
    throw OpenAiApiError.invalidRequest('messages must be a non-empty array', 'messages', 'missing_required_parameter');
  }

  assertSingleChoice(body);

  const offer = parseChatToolOffer(body);
  const turnMessages = messages.map((message, index): TurnEntry => {
    const param = `messages[${index}]`;

    if (!isRecord(message)) {
      throw OpenAiApiError.invalidRequest(`${param} must be an object`, param);
    }

    const role = String(message['role'] ?? '');

    if (role === 'tool') {
      const callId = message['tool_call_id'];

      return typeof callId === 'string' && callId
        ? { role: 'tool', result: { callId, output: toolOutputText(message['content'], `${param}.content`) } }
        : { role: 'tool' };
    }

    if (role === 'function') {
      const name = message['name'];

      return typeof name === 'string' && name
        ? { role: 'tool', result: { name, output: toolOutputText(message['content'], `${param}.content`) } }
        : { role: 'tool' };
    }

    if (!CHAT_ROLES.has(role)) {
      throw OpenAiApiError.invalidRequest(`${param}.role '${role}' is not supported`, `${param}.role`);
    }

    // Assistant turns before the new turn are history the agent already has; their content is not validated.
    const text = role === 'assistant' ? '' : extractContentText(message['content'], `${param}.content`);

    return { role: role as TurnRole, text };
  });
  const { prompt, toolResults } = buildTurn(turnMessages, 'messages');
  const streamOptions = body['stream_options'];
  const includeUsage = isRecord(streamOptions) && streamOptions['include_usage'] === true;

  return {
    model,
    prompt,
    stream: parseOptionalBoolean(body, 'stream'),
    includeUsage,
    chatId: resolveExplicitChatId(body, chatIdHeader),
    metadata: parseMetadata(body['metadata']),
    toolActivity: parseToolActivity(body, toolActivityHeader),
    clientTools: offer.clientTools,
    toolChoice: offer.toolChoice,
    // The deprecated interface hands out one function call per reply.
    parallelToolCalls: offer.legacyFunctions ? false : parseParallelToolCalls(body),
    legacyFunctions: offer.legacyFunctions,
    toolResults,
  };
}

const RESPONSE_INPUT_ROLES = new Set(['system', 'developer', 'user', 'assistant']);

function parseResponsesInput(input: unknown): { prompt: string; toolResults: ParsedToolResult[] } {
  if (typeof input === 'string') {
    if (!input.trim()) {
      throw OpenAiApiError.invalidRequest('input must not be empty', 'input');
    }

    return { prompt: input, toolResults: [] };
  }

  if (!Array.isArray(input) || input.length === 0) {
    throw OpenAiApiError.invalidRequest(
      'input must be a string or a non-empty array of items',
      'input',
      'missing_required_parameter',
    );
  }

  const turnMessages = input.map((item, index): TurnEntry => {
    const param = `input[${index}]`;

    if (!isRecord(item)) {
      throw OpenAiApiError.invalidRequest(`${param} must be an object`, param);
    }

    const type = item['type'] === undefined ? 'message' : String(item['type']);

    if (type === 'function_call_output') {
      const callId = item['call_id'];

      return typeof callId === 'string' && callId
        ? { role: 'tool', result: { callId, output: toolOutputText(item['output'], `${param}.output`) } }
        : { role: 'tool' };
    }

    if (type !== 'message') {
      // Function calls, reasoning items, hosted tool items, item references, … are history / have no equivalent.
      return { role: 'tool' };
    }

    const role = String(item['role'] ?? '');

    if (!RESPONSE_INPUT_ROLES.has(role)) {
      throw OpenAiApiError.invalidRequest(`${param}.role '${role}' is not supported`, `${param}.role`);
    }

    const text = role === 'assistant' ? '' : extractContentText(item['content'], `${param}.content`);

    return { role: role as TurnRole, text };
  });

  return buildTurn(turnMessages, 'input');
}

export function parseResponsesRequest(
  rawBody: unknown,
  chatIdHeader: string | undefined,
  toolActivityHeader?: string,
): ParsedResponsesRequest {
  const body = requireBody(rawBody);
  const model = parseModel(body);

  if (body['background'] === true) {
    throw OpenAiApiError.unsupported('Background responses are not supported.', 'background');
  }

  const instructionsValue = body['instructions'];

  if (instructionsValue !== undefined && instructionsValue !== null && typeof instructionsValue !== 'string') {
    throw OpenAiApiError.invalidRequest('instructions must be a string', 'instructions');
  }

  const instructions = typeof instructionsValue === 'string' && instructionsValue.trim() ? instructionsValue : null;
  const offer = parseResponsesToolOffer(body);
  const input = parseResponsesInput(body['input']);
  const prompt = instructions && input.prompt ? `${instructions.trim()}\n\n${input.prompt.trim()}` : input.prompt;
  const conversation = body['conversation'];
  const previousResponseIdValue = body['previous_response_id'];
  const candidates: Array<{ value: string; param: string }> = [];
  let previousResponseId: string | null = null;

  if (
    conversation !== undefined &&
    conversation !== null &&
    previousResponseIdValue !== undefined &&
    previousResponseIdValue !== null
  ) {
    throw OpenAiApiError.invalidRequest(
      'conversation and previous_response_id cannot be used together.',
      'previous_response_id',
    );
  }

  if (conversation !== undefined && conversation !== null) {
    const conversationId =
      typeof conversation === 'string' ? conversation : isRecord(conversation) ? conversation['id'] : undefined;

    if (typeof conversationId !== 'string') {
      throw OpenAiApiError.invalidRequest('conversation must be a conversation id or { id }', 'conversation');
    }

    candidates.push({ value: conversationId, param: 'conversation' });
  }

  if (previousResponseIdValue !== undefined && previousResponseIdValue !== null) {
    if (typeof previousResponseIdValue !== 'string') {
      throw OpenAiApiError.invalidRequest('previous_response_id must be a string', 'previous_response_id');
    }

    const chatId = parseResponseId(previousResponseIdValue);

    if (!chatId) {
      throw OpenAiApiError.notFound(
        `Previous response with id '${previousResponseIdValue}' not found.`,
        'previous_response_not_found',
        'previous_response_id',
      );
    }

    previousResponseId = previousResponseIdValue.trim();
    candidates.push({ value: chatId, param: 'previous_response_id' });
  }

  const explicit = resolveExplicitChatId(body, chatIdHeader);

  if (explicit) {
    candidates.push({ value: explicit, param: 'chat_id' });
  }

  return {
    model,
    prompt,
    stream: parseOptionalBoolean(body, 'stream'),
    chatId: mergeChatIdCandidates(candidates),
    conversationRequested: conversation !== undefined && conversation !== null,
    toolActivity: parseToolActivity(body, toolActivityHeader),
    previousResponseId,
    instructions,
    metadata: parseMetadata(body['metadata']),
    clientTools: offer.clientTools,
    toolChoice: offer.toolChoice,
    parallelToolCalls: parseParallelToolCalls(body),
    toolResults: input.toolResults,
  };
}

const MAX_TITLE_LENGTH = 255;

function titleFromMetadata(metadata: OpenAiMetadata | null): string | undefined {
  const title = metadata?.['title']?.trim();

  if (!title) {
    return undefined;
  }

  return title.slice(0, MAX_TITLE_LENGTH);
}

export function parseConversationCreateRequest(rawBody: unknown): ParsedConversationCreateRequest {
  const body = rawBody === undefined || rawBody === null ? {} : requireBody(rawBody);
  const items = body['items'];

  if (items !== undefined && items !== null && (!Array.isArray(items) || items.length > 0)) {
    throw OpenAiApiError.unsupported(
      'Initial conversation items are not supported: send them as the first turn via /responses.',
      'items',
    );
  }

  const metadata = parseMetadata(body['metadata']);

  return { title: titleFromMetadata(metadata), metadata };
}

export function parseConversationUpdateRequest(rawBody: unknown): ParsedConversationCreateRequest {
  const body = requireBody(rawBody);

  if (body['metadata'] === undefined) {
    throw OpenAiApiError.invalidRequest('metadata is required', 'metadata', 'missing_required_parameter');
  }

  const metadata = parseMetadata(body['metadata']);

  return { title: titleFromMetadata(metadata), metadata };
}

export interface ParsedListQuery {
  limit: number;
  order: 'asc' | 'desc';
  after?: string;
}

/** `limit` (1-100, default 20), `order` (`asc` | `desc`, default desc) and `after` (item id cursor). */
export function parseListQuery(query: Record<string, unknown>): ParsedListQuery {
  const rawLimit = query['limit'];
  let limit = 20;

  if (rawLimit !== undefined && rawLimit !== '') {
    const parsed = Number(rawLimit);

    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
      throw OpenAiApiError.invalidRequest('limit must be an integer between 1 and 100', 'limit');
    }

    limit = parsed;
  }

  const rawOrder = query['order'];
  let order: 'asc' | 'desc' = 'desc';

  if (rawOrder !== undefined && rawOrder !== '') {
    if (rawOrder !== 'asc' && rawOrder !== 'desc') {
      throw OpenAiApiError.invalidRequest("order must be 'asc' or 'desc'", 'order');
    }

    order = rawOrder;
  }

  const rawAfter = query['after'];
  let after: string | undefined;

  if (rawAfter !== undefined && rawAfter !== '') {
    if (typeof rawAfter !== 'string') {
      throw OpenAiApiError.invalidRequest('after must be an item id', 'after');
    }

    after = parseItemId(rawAfter);

    if (!after) {
      throw OpenAiApiError.invalidRequest('after must be an item id', 'after');
    }
  }

  return { limit, order, after };
}
