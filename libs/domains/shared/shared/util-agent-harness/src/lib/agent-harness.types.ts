/**
 * Wire types of the Agenstra OpenAI-compatible API: the subset of OpenAI's schemas the controller fills, plus the
 * Agenstra extensions (`chat_id`, `tool_activity`, `X-Agenstra-Chat-Id`). See
 * `docs/agenstra/features/openai-compatible-api.md`.
 */

export type JsonSchema = Record<string, unknown>;

export interface AgentHarnessErrorBody {
  error: {
    message: string;
    type: string;
    param: string | null;
    code: string | null;
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------------------------------------------------

export interface AgentHarnessModel {
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
}

export interface AgentHarnessModelList {
  object: 'list';
  data: AgentHarnessModel[];
}

// ---------------------------------------------------------------------------------------------------------------------
// Conversations (chat sessions)
// ---------------------------------------------------------------------------------------------------------------------

export interface AgentHarnessConversation {
  /** `conv_<32 hex>` */
  id: string;
  object: 'conversation';
  created_at: number;
  metadata: {
    title?: string;
    agenstra_kind?: string;
    /** Chat session UUID. */
    agenstra_chat_id: string;
    [key: string]: string | undefined;
  };
}

export interface AgentHarnessConversationDeleted {
  id: string;
  object: 'conversation.deleted';
  deleted: boolean;
}

export interface AgentHarnessOutputText {
  type: 'output_text';
  text: string;
  annotations?: unknown[];
  logprobs?: unknown[];
}

export interface AgentHarnessInputText {
  type: 'input_text';
  text: string;
}

export interface AgentHarnessConversationItem {
  type: 'message';
  /** `msg_<32 hex>` */
  id: string;
  status: 'completed' | 'incomplete' | 'in_progress';
  role: 'user' | 'assistant';
  content: Array<AgentHarnessInputText | AgentHarnessOutputText>;
  created_at: number;
}

export interface AgentHarnessList<T> {
  object: 'list';
  data: T[];
  first_id: string | null;
  last_id: string | null;
  has_more: boolean;
}

export interface AgentHarnessListItemsQuery {
  limit?: number;
  order?: 'asc' | 'desc';
  after?: string;
}

// ---------------------------------------------------------------------------------------------------------------------
// Responses API
// ---------------------------------------------------------------------------------------------------------------------

export interface AgentHarnessFunctionToolDefinition {
  type: 'function';
  name: string;
  description?: string;
  parameters?: JsonSchema;
  strict?: boolean;
}

export type AgentHarnessToolChoice =
  | 'auto'
  | 'none'
  | 'required'
  | { type: 'function'; name: string }
  | { type: 'allowed_tools'; mode: 'auto' | 'required'; tools: Array<{ type: 'function'; name: string }> };

export type AgentHarnessResponseInputItem =
  | {
      type?: 'message';
      role: 'system' | 'developer' | 'user' | 'assistant';
      content: string | Array<AgentHarnessInputText>;
    }
  | { type: 'function_call_output'; call_id: string; output: string };

export interface AgentHarnessResponseRequest {
  model: string;
  input: string | AgentHarnessResponseInputItem[];
  instructions?: string;
  /** `conv_…` id or `{ id }`. Mutually exclusive with `previous_response_id`. */
  conversation?: string | { id: string };
  previous_response_id?: string;
  tools?: AgentHarnessFunctionToolDefinition[];
  tool_choice?: AgentHarnessToolChoice;
  parallel_tool_calls?: boolean;
  stream?: boolean;
  metadata?: Record<string, string>;
  /** Agenstra extension: chat session UUID or `conv_…` id. */
  chat_id?: string;
  /** Agenstra extension: report the agent's own tool calls as `mcp_call` items. */
  tool_activity?: boolean;
}

export interface AgentHarnessOutputMessage {
  type: 'message';
  id: string;
  status: 'in_progress' | 'completed' | 'incomplete';
  role: 'assistant';
  content: AgentHarnessOutputText[];
}

/** A tool the agent ran in its own workspace (read-only activity; never executed by the client). */
export interface AgentHarnessMcpCallItem {
  type: 'mcp_call';
  id: string;
  server_label: string;
  name: string;
  arguments: string;
  output: string | null;
  error: string | null;
  status: 'in_progress' | 'completed' | 'failed';
}

/** A client tool call the harness must execute and answer with `function_call_output`. */
export interface AgentHarnessFunctionCallItem {
  type: 'function_call';
  id: string;
  call_id: string;
  name: string;
  arguments: string;
  status: 'in_progress' | 'completed';
}

export type AgentHarnessOutputItem = AgentHarnessOutputMessage | AgentHarnessMcpCallItem | AgentHarnessFunctionCallItem;

export interface AgentHarnessResponsesUsage {
  input_tokens: number;
  input_tokens_details: { cached_tokens: number };
  output_tokens: number;
  output_tokens_details: { reasoning_tokens: number };
  total_tokens: number;
}

export type AgentHarnessResponseStatus = 'in_progress' | 'completed' | 'incomplete' | 'failed';

export interface AgentHarnessResponse {
  id: string;
  object: 'response';
  created_at: number;
  status: AgentHarnessResponseStatus;
  error: { code: string; message: string } | null;
  incomplete_details: { reason: string } | null;
  instructions: string | null;
  model: string;
  output: AgentHarnessOutputItem[];
  output_text: string;
  previous_response_id: string | null;
  conversation: { id: string } | null;
  usage: AgentHarnessResponsesUsage | null;
  metadata: Record<string, string>;
}

/** Server-sent events of a streamed Responses request (the subset the controller emits). */
export type AgentHarnessResponseStreamEvent =
  | { type: 'response.created' | 'response.in_progress'; sequence_number: number; response: AgentHarnessResponse }
  | {
      type: 'response.completed' | 'response.incomplete' | 'response.failed';
      sequence_number: number;
      response: AgentHarnessResponse;
    }
  | {
      type: 'response.output_item.added' | 'response.output_item.done';
      sequence_number: number;
      output_index: number;
      item: AgentHarnessOutputItem;
    }
  | {
      type: 'response.output_text.delta';
      sequence_number: number;
      item_id: string;
      output_index: number;
      content_index: number;
      delta: string;
    }
  | {
      type: 'response.output_text.done';
      sequence_number: number;
      item_id: string;
      output_index: number;
      content_index: number;
      text: string;
    }
  | {
      type: 'response.function_call_arguments.delta';
      sequence_number: number;
      item_id: string;
      output_index: number;
      delta: string;
    }
  | {
      type: 'response.function_call_arguments.done';
      sequence_number: number;
      item_id: string;
      output_index: number;
      name: string;
      arguments: string;
    }
  | { type: 'error'; sequence_number: number; code: string | null; message: string; param: string | null }
  | { type: string; sequence_number: number; [key: string]: unknown };

// ---------------------------------------------------------------------------------------------------------------------
// Chat Completions API
// ---------------------------------------------------------------------------------------------------------------------

export interface AgentHarnessChatToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export type AgentHarnessChatMessage =
  | { role: 'system' | 'developer' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: AgentHarnessChatToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface AgentHarnessChatCompletionRequest {
  model: string;
  messages: AgentHarnessChatMessage[];
  tools?: Array<{ type: 'function'; function: Omit<AgentHarnessFunctionToolDefinition, 'type'> }>;
  tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
  parallel_tool_calls?: boolean;
  stream?: boolean;
  stream_options?: { include_usage?: boolean };
  /** Agenstra extension: chat session UUID or `conv_…` id. */
  chat_id?: string;
  /** Agenstra extension: report the agent's own tool calls as `reasoning_content`. */
  tool_activity?: boolean;
}

export interface AgentHarnessChatCompletionUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_tokens_details?: { cached_tokens: number };
  completion_tokens_details?: { reasoning_tokens: number };
}

export interface AgentHarnessChatCompletion {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    finish_reason: 'stop' | 'content_filter' | 'tool_calls' | 'function_call' | null;
    message: {
      role: 'assistant';
      content: string | null;
      reasoning_content?: string;
      tool_calls?: AgentHarnessChatToolCall[];
    };
  }>;
  usage?: AgentHarnessChatCompletionUsage;
}

export interface AgentHarnessChatCompletionChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    finish_reason: 'stop' | 'content_filter' | 'tool_calls' | 'function_call' | null;
    delta: {
      role?: 'assistant';
      content?: string;
      reasoning_content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: 'function';
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
  usage?: AgentHarnessChatCompletionUsage | null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Transport results
// ---------------------------------------------------------------------------------------------------------------------

/** A turn result together with the chat session it ran in (`X-Agenstra-Chat-Id`). */
export interface AgentHarnessWithChat<T> {
  data: T;
  chatId: string | null;
}

/** A streamed turn: the events and the chat session reported by the response headers. */
export interface AgentHarnessStream<T> extends AsyncIterable<T> {
  chatId: string | null;
}
