import {
  normalizeAgentHarnessConnection,
  resolveAgentHarnessCredential,
  type AgentHarnessConnectionConfig,
  type NormalizedAgentHarnessConnection,
} from './agent-harness.config';
import {
  AGENT_HARNESS_CHAT_ID_HEADER,
  AGENT_HARNESS_CONVERSATION_ID_PATTERN,
  AGENT_HARNESS_MAX_BODY_BYTES,
  AGENT_HARNESS_UUID_PATTERN,
} from './agent-harness.constants';
import { AgentHarnessAbortError, AgentHarnessApiError, AgentHarnessConfigError } from './agent-harness.errors';
import type {
  AgentHarnessChatCompletion,
  AgentHarnessChatCompletionChunk,
  AgentHarnessChatCompletionRequest,
  AgentHarnessConversation,
  AgentHarnessConversationDeleted,
  AgentHarnessConversationItem,
  AgentHarnessList,
  AgentHarnessListItemsQuery,
  AgentHarnessModel,
  AgentHarnessModelList,
  AgentHarnessResponse,
  AgentHarnessResponseRequest,
  AgentHarnessResponseStreamEvent,
  AgentHarnessStream,
  AgentHarnessWithChat,
} from './agent-harness.types';
import { readSseFrames } from './sse-reader';

export interface AgentHarnessRequestOptions {
  signal?: AbortSignal;
  /** Chat session UUID or `conv_…` id, sent as `X-Agenstra-Chat-Id`. */
  chatId?: string;
  /** Opt in to read-only agent tool activity (`X-Agenstra-Tool-Activity: true`). */
  toolActivity?: boolean;
}

/** Normalizes a chat session selector to the `conv_<hex>` form; rejects anything else before it reaches a URL. */
export function toConversationId(value: string): string {
  const trimmed = String(value ?? '').trim();

  if (AGENT_HARNESS_CONVERSATION_ID_PATTERN.test(trimmed)) {
    return trimmed.toLowerCase();
  }

  if (AGENT_HARNESS_UUID_PATTERN.test(trimmed)) {
    return `conv_${trimmed.replace(/-/g, '').toLowerCase()}`;
  }

  throw new AgentHarnessConfigError('Conversation ids must be conv_… ids or chat session UUIDs');
}

/** Chat session UUID of a `conv_…` id (or UUID). */
export function toChatSessionId(value: string): string {
  const hex = toConversationId(value).slice('conv_'.length);

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function combineSignals(signals: Array<AbortSignal | undefined>): { signal?: AbortSignal; dispose: () => void } {
  const active = signals.filter((signal): signal is AbortSignal => !!signal);

  if (active.length === 0) {
    return { dispose: () => undefined };
  }

  if (active.length === 1) {
    return { signal: active[0], dispose: () => undefined };
  }

  const controller = new AbortController();
  const listeners: Array<() => void> = [];

  for (const signal of active) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }

    const listener = () => controller.abort(signal.reason);

    signal.addEventListener('abort', listener, { once: true });
    listeners.push(() => signal.removeEventListener('abort', listener));
  }

  return { signal: controller.signal, dispose: () => listeners.forEach((remove) => remove()) };
}

/**
 * Low-level client of one agent's OpenAI-compatible API (models, chat completions, responses, conversations). It
 * mirrors the wire format; {@link AgentHarness} builds the tool loop, context and sessions on top of it.
 *
 * Works in browsers and Node 18+ (global `fetch`, `ReadableStream`, `TextDecoder`); no OpenAI SDK required.
 */
export class AgentHarnessClient {
  readonly connection: NormalizedAgentHarnessConnection;

  constructor(config: AgentHarnessConnectionConfig) {
    this.connection = normalizeAgentHarnessConnection(config);
  }

  get clientId(): string {
    return this.connection.clientId;
  }

  get agentId(): string {
    return this.connection.agentId;
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Models
  // -------------------------------------------------------------------------------------------------------------------

  async listModels(options: { signal?: AbortSignal } = {}): Promise<AgentHarnessModel[]> {
    const list = await this.json<AgentHarnessModelList>('GET', 'models', undefined, options);

    return Array.isArray(list?.data) ? list.data : [];
  }

  async getModel(model: string, options: { signal?: AbortSignal } = {}): Promise<AgentHarnessModel> {
    const path = String(model)
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');

    return this.json<AgentHarnessModel>('GET', `models/${path}`, undefined, options);
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Conversations
  // -------------------------------------------------------------------------------------------------------------------

  async createConversation(
    params: { title?: string; metadata?: Record<string, string> } = {},
    options: { signal?: AbortSignal } = {},
  ): Promise<AgentHarnessConversation> {
    const metadata = { ...(params.metadata ?? {}), ...(params.title ? { title: params.title } : {}) };

    return this.json('POST', 'conversations', Object.keys(metadata).length > 0 ? { metadata } : {}, options);
  }

  async getConversation(
    conversationId: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<AgentHarnessConversation> {
    return this.json('GET', `conversations/${toConversationId(conversationId)}`, undefined, options);
  }

  async renameConversation(
    conversationId: string,
    title: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<AgentHarnessConversation> {
    return this.json('POST', `conversations/${toConversationId(conversationId)}`, { metadata: { title } }, options);
  }

  async deleteConversation(
    conversationId: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<AgentHarnessConversationDeleted> {
    return this.json('DELETE', `conversations/${toConversationId(conversationId)}`, undefined, options);
  }

  async listConversationItems(
    conversationId: string,
    query: AgentHarnessListItemsQuery = {},
    options: { signal?: AbortSignal } = {},
  ): Promise<AgentHarnessList<AgentHarnessConversationItem>> {
    const params = new URLSearchParams();

    if (query.limit !== undefined) {
      params.set('limit', String(Math.max(1, Math.min(100, Math.floor(query.limit)))));
    }

    if (query.order) {
      params.set('order', query.order === 'asc' ? 'asc' : 'desc');
    }

    if (query.after) {
      params.set('after', query.after);
    }

    const search = params.toString();

    return this.json(
      'GET',
      `conversations/${toConversationId(conversationId)}/items${search ? `?${search}` : ''}`,
      undefined,
      options,
    );
  }

  /** Walks all items of a conversation (oldest first by default). */
  async *iterateConversationItems(
    conversationId: string,
    query: Omit<AgentHarnessListItemsQuery, 'after'> = {},
    options: { signal?: AbortSignal } = {},
  ): AsyncGenerator<AgentHarnessConversationItem> {
    let after: string | undefined;

    for (;;) {
      const page = await this.listConversationItems(
        conversationId,
        { limit: query.limit ?? 100, order: query.order ?? 'asc', after },
        options,
      );

      for (const item of page.data) {
        yield item;
      }

      if (!page.has_more || !page.last_id) {
        return;
      }

      after = page.last_id;
    }
  }

  async getConversationItem(
    conversationId: string,
    itemId: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<AgentHarnessConversationItem> {
    if (!/^msg_[0-9a-f]{32}$/i.test(itemId)) {
      throw new AgentHarnessConfigError('Item ids must be msg_… ids');
    }

    return this.json('GET', `conversations/${toConversationId(conversationId)}/items/${itemId}`, undefined, options);
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Responses
  // -------------------------------------------------------------------------------------------------------------------

  async createResponse(
    request: AgentHarnessResponseRequest,
    options: AgentHarnessRequestOptions = {},
  ): Promise<AgentHarnessWithChat<AgentHarnessResponse>> {
    const response = await this.send('POST', 'responses', { ...request, stream: false }, options, false);

    return {
      data: (await response.json()) as AgentHarnessResponse,
      chatId: response.headers.get('x-agenstra-chat-id'),
    };
  }

  async streamResponse(
    request: AgentHarnessResponseRequest,
    options: AgentHarnessRequestOptions = {},
  ): Promise<AgentHarnessStream<AgentHarnessResponseStreamEvent>> {
    const response = await this.send('POST', 'responses', { ...request, stream: true }, options, false);

    return this.eventStream<AgentHarnessResponseStreamEvent>(response, options.signal);
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Chat Completions
  // -------------------------------------------------------------------------------------------------------------------

  async createChatCompletion(
    request: AgentHarnessChatCompletionRequest,
    options: AgentHarnessRequestOptions = {},
  ): Promise<AgentHarnessWithChat<AgentHarnessChatCompletion>> {
    const response = await this.send('POST', 'chat/completions', { ...request, stream: false }, options, false);

    return {
      data: (await response.json()) as AgentHarnessChatCompletion,
      chatId: response.headers.get('x-agenstra-chat-id'),
    };
  }

  async streamChatCompletion(
    request: AgentHarnessChatCompletionRequest,
    options: AgentHarnessRequestOptions = {},
  ): Promise<AgentHarnessStream<AgentHarnessChatCompletionChunk>> {
    const response = await this.send('POST', 'chat/completions', { ...request, stream: true }, options, false);

    return this.eventStream<AgentHarnessChatCompletionChunk>(response, options.signal);
  }

  // -------------------------------------------------------------------------------------------------------------------

  private async json<T>(method: string, path: string, body: unknown, options: AgentHarnessRequestOptions): Promise<T> {
    const response = await this.send(method, path, body, options, true);

    return (await response.json()) as T;
  }

  private async send(
    method: string,
    path: string,
    body: unknown,
    options: AgentHarnessRequestOptions,
    bounded: boolean,
  ): Promise<Response> {
    if (options.signal?.aborted) {
      throw new AgentHarnessAbortError();
    }

    const headers: Record<string, string> = {
      Accept: 'application/json, text/event-stream',
      ...this.connection.headers,
    };
    const token = await resolveAgentHarnessCredential(this.connection.credential);

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    if (options.chatId) {
      headers[AGENT_HARNESS_CHAT_ID_HEADER] = toConversationId(options.chatId);
    }

    if (options.toolActivity) {
      headers['X-Agenstra-Tool-Activity'] = 'true';
    }

    let payload: string | undefined;

    if (body !== undefined) {
      payload = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';

      if (new TextEncoder().encode(payload).length > AGENT_HARNESS_MAX_BODY_BYTES) {
        throw new AgentHarnessConfigError('The request exceeds the 1 MB body limit of the OpenAI-compatible API');
      }
    }

    const timeout = bounded ? new AbortController() : undefined;
    const timer = timeout ? setTimeout(() => timeout.abort(), this.connection.requestTimeoutMs) : undefined;
    const combined = combineSignals([options.signal, timeout?.signal]);
    let response: Response;

    try {
      response = await this.connection.fetch(`${this.connection.baseUrl}/${path}`, {
        method,
        headers,
        body: payload,
        signal: combined.signal,
        // Never follow redirects with the credential to another origin.
        redirect: 'error',
        credentials: this.connection.requestCredentials,
      });
    } catch (error) {
      if (options.signal?.aborted) {
        throw new AgentHarnessAbortError();
      }

      if (timeout?.signal.aborted) {
        throw new AgentHarnessApiError(504, 'The Agenstra API did not answer in time', 'server_error', 'timeout');
      }

      // Network details (addresses, TLS errors) stay on `cause`: messages may be relayed to browsers.
      throw Object.assign(
        new AgentHarnessApiError(503, 'The Agenstra API is unreachable', 'server_error', 'unreachable'),
        { cause: error },
      );
    } finally {
      if (timer) {
        clearTimeout(timer);
      }

      combined.dispose();
    }

    if (!response.ok) {
      let errorBody: unknown;

      try {
        errorBody = await response.json();
      } catch {
        errorBody = undefined;
      }

      throw AgentHarnessApiError.fromBody(response.status, errorBody);
    }

    return response;
  }

  private eventStream<T>(response: Response, signal?: AbortSignal): AgentHarnessStream<T> {
    const chatId = response.headers.get('x-agenstra-chat-id');
    const contentType = response.headers.get('content-type') ?? '';
    const body = response.body;

    async function* iterate(): AsyncGenerator<T> {
      if (!contentType.includes('text/event-stream') || !body) {
        // Some errors are answered as JSON before the stream starts.
        throw AgentHarnessApiError.fromBody(response.status, await response.json().catch(() => undefined));
      }

      try {
        for await (const frame of readSseFrames(body)) {
          if (frame.data === '[DONE]') {
            return;
          }

          let parsed: Record<string, unknown>;

          try {
            parsed = JSON.parse(frame.data) as Record<string, unknown>;
          } catch {
            continue;
          }

          // Chat Completions errors arrive as an OpenAI error envelope inside the stream.
          if (parsed && typeof parsed === 'object' && 'error' in parsed && !('type' in parsed)) {
            throw AgentHarnessApiError.fromStreamEvent(parsed);
          }

          yield parsed as T;
        }
      } catch (error) {
        if (signal?.aborted) {
          throw new AgentHarnessAbortError();
        }

        throw error;
      }
    }

    const iterator = iterate();

    return Object.assign(iterator, { chatId });
  }
}
