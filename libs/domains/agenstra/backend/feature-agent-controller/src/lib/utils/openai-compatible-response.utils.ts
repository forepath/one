import type { ChatOutputUsage } from './chat-output-usage.utils';
import { toConversationId } from './openai-compatible-request.utils';
import type { OpenAiMetadata } from './openai-compatible-request.utils';

/** Response objects of the OpenAI-compatible API (subset of OpenAI's schemas that Agenstra can fill). */

export type OpenAiFinishReason = 'stop' | 'content_filter';

export interface OpenAiChatCompletionUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_tokens_details: { cached_tokens: number };
  completion_tokens_details: { reasoning_tokens: number };
}

export interface OpenAiResponsesUsage {
  input_tokens: number;
  input_tokens_details: { cached_tokens: number };
  output_tokens: number;
  output_tokens_details: { reasoning_tokens: number };
  total_tokens: number;
}

interface NormalizedUsage {
  input: number;
  cached: number;
  output: number;
  reasoning: number;
}

function count(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

/**
 * Agent usage → OpenAI accounting. OpenAI counts cached prompt tokens inside the prompt total and reasoning tokens
 * inside the completion total; the agent reports them separately. Unknown usage is reported as zero.
 */
function normalizeUsage(usage: ChatOutputUsage | undefined): NormalizedUsage {
  const cached = count(usage?.cacheReadTokens);
  const reasoning = count(usage?.reasoningTokens);

  return {
    input: count(usage?.inputTokens) + cached + count(usage?.cacheWriteTokens),
    cached,
    output: count(usage?.outputTokens) + reasoning,
    reasoning,
  };
}

export function toChatCompletionUsage(usage: ChatOutputUsage | undefined): OpenAiChatCompletionUsage {
  const normalized = normalizeUsage(usage);

  return {
    prompt_tokens: normalized.input,
    completion_tokens: normalized.output,
    total_tokens: normalized.input + normalized.output,
    prompt_tokens_details: { cached_tokens: normalized.cached },
    completion_tokens_details: { reasoning_tokens: normalized.reasoning },
  };
}

export function toResponsesUsage(usage: ChatOutputUsage | undefined): OpenAiResponsesUsage {
  const normalized = normalizeUsage(usage);

  return {
    input_tokens: normalized.input,
    input_tokens_details: { cached_tokens: normalized.cached },
    output_tokens: normalized.output,
    output_tokens_details: { reasoning_tokens: normalized.reasoning },
    total_tokens: normalized.input + normalized.output,
  };
}

export function unixSeconds(date: Date | string | number = Date.now()): number {
  const ms = date instanceof Date ? date.getTime() : typeof date === 'string' ? Date.parse(date) : date;

  return Math.floor((Number.isFinite(ms) ? ms : Date.now()) / 1000);
}

// ---------------------------------------------------------------------------------------------------------------------
// Chat Completions
// ---------------------------------------------------------------------------------------------------------------------

export function buildChatCompletion(params: {
  id: string;
  created: number;
  model: string;
  text: string;
  finishReason: OpenAiFinishReason;
  usage?: ChatOutputUsage;
}) {
  return {
    id: params.id,
    object: 'chat.completion' as const,
    created: params.created,
    model: params.model,
    system_fingerprint: null,
    choices: [
      {
        index: 0,
        message: { role: 'assistant' as const, content: params.text, refusal: null, annotations: [] },
        logprobs: null,
        finish_reason: params.finishReason,
      },
    ],
    usage: toChatCompletionUsage(params.usage),
  };
}

export function buildChatCompletionChunk(params: {
  id: string;
  created: number;
  model: string;
  delta: { role?: 'assistant'; content?: string };
  finishReason: OpenAiFinishReason | null;
  includeUsage: boolean;
}) {
  return {
    id: params.id,
    object: 'chat.completion.chunk' as const,
    created: params.created,
    model: params.model,
    system_fingerprint: null,
    choices: [{ index: 0, delta: params.delta, logprobs: null, finish_reason: params.finishReason }],
    ...(params.includeUsage ? { usage: null } : {}),
  };
}

/** Final usage chunk (`stream_options.include_usage`): empty choices plus the usage of the whole turn. */
export function buildChatCompletionUsageChunk(params: {
  id: string;
  created: number;
  model: string;
  usage?: ChatOutputUsage;
}) {
  return {
    id: params.id,
    object: 'chat.completion.chunk' as const,
    created: params.created,
    model: params.model,
    system_fingerprint: null,
    choices: [],
    usage: toChatCompletionUsage(params.usage),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------------------------------------------------

export function buildOutputMessage(params: {
  id: string;
  text: string;
  status: 'in_progress' | 'completed' | 'incomplete';
}) {
  return {
    type: 'message' as const,
    id: params.id,
    status: params.status,
    role: 'assistant' as const,
    content: params.status === 'in_progress' ? [] : [buildOutputText(params.text)],
  };
}

export function buildOutputText(text: string) {
  return { type: 'output_text' as const, text, annotations: [], logprobs: [] };
}

export type OpenAiResponseStatus = 'in_progress' | 'completed' | 'incomplete' | 'failed';

export function buildResponseObject(params: {
  id: string;
  createdAt: number;
  model: string;
  status: OpenAiResponseStatus;
  chatId: string;
  conversationRequested: boolean;
  previousResponseId: string | null;
  instructions: string | null;
  metadata: OpenAiMetadata | null;
  output: ReturnType<typeof buildOutputMessage>[];
  usage?: ChatOutputUsage;
  error?: { code: string; message: string } | null;
}) {
  const text = params.output
    .flatMap((item) => item.content)
    .map((part) => part.text)
    .join('');

  return {
    id: params.id,
    object: 'response' as const,
    created_at: params.createdAt,
    status: params.status,
    background: false,
    error: params.error ?? null,
    incomplete_details: params.status === 'incomplete' ? { reason: 'content_filter' as const } : null,
    instructions: params.instructions,
    max_output_tokens: null,
    model: params.model,
    output: params.output,
    output_text: text,
    parallel_tool_calls: false,
    previous_response_id: params.previousResponseId,
    conversation: params.conversationRequested ? { id: toConversationId(params.chatId) } : null,
    reasoning: { effort: null, summary: null },
    // Response objects are not retrievable later; the turn itself is stored in the chat session (conversation).
    store: false,
    temperature: null,
    text: { format: { type: 'text' as const } },
    tool_choice: 'auto' as const,
    tools: [],
    top_p: null,
    truncation: 'disabled' as const,
    usage: params.status === 'in_progress' ? null : toResponsesUsage(params.usage),
    user: null,
    metadata: params.metadata ?? {},
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Models / conversations
// ---------------------------------------------------------------------------------------------------------------------

export function buildModel(id: string, ownedBy: string) {
  return { id, object: 'model' as const, created: 0, owned_by: ownedBy };
}

/** `provider/model` ids are owned by their provider; the default alias is owned by the agent. */
export function modelOwner(id: string): string {
  const slash = id.indexOf('/');

  return slash > 0 ? id.slice(0, slash) : 'agenstra';
}

export function buildConversation(session: {
  id: string;
  title?: string | null;
  kind?: string;
  createdAt: Date | string;
}) {
  return {
    id: toConversationId(session.id),
    object: 'conversation' as const,
    created_at: unixSeconds(session.createdAt),
    metadata: {
      ...(session.title ? { title: session.title } : {}),
      ...(session.kind ? { agenstra_kind: session.kind } : {}),
      agenstra_chat_id: session.id,
    },
  };
}
