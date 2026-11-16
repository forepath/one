import { AgentHarnessClient, toChatSessionId, toConversationId } from './agent-harness.client';
import type { AgentHarnessConnectionConfig } from './agent-harness.config';
import {
  AGENT_HARNESS_DEFAULT_MAX_TOOL_ROUNDS,
  AGENT_HARNESS_DEFAULT_MODEL,
  AGENT_HARNESS_MESSAGE_MAX_CHARS,
  AGENT_HARNESS_RELEASE_MAX_ROUNDS,
  AGENT_HARNESS_RELEASE_TIMEOUT_MS,
  AGENT_HARNESS_TOOL_LIMITS,
} from './agent-harness.constants';
import {
  AgentHarnessAbortError,
  AgentHarnessApiError,
  AgentHarnessConfigError,
  isAbortError,
} from './agent-harness.errors';
import {
  emptyUsage,
  type AgentActivity,
  type AgentHarnessEvent,
  type AgentToolResultSummary,
  type AgentTurnResult,
  type AgentTurnUsage,
} from './agent-harness.events';
import type {
  AgentHarnessConversation,
  AgentHarnessConversationItem,
  AgentHarnessFunctionCallItem,
  AgentHarnessFunctionToolDefinition,
  AgentHarnessMcpCallItem,
  AgentHarnessResponse,
  AgentHarnessResponseInputItem,
  AgentHarnessResponseRequest,
  AgentHarnessResponsesUsage,
  AgentHarnessToolChoice,
} from './agent-harness.types';
import {
  AgentContextRegistry,
  stripHarnessInstructions,
  wrapHarnessInstructions,
  type AgentContextProvider,
} from './context-providers';
import {
  AgentToolRegistry,
  type AgentToolApprovalRequest,
  type AgentToolCallRequest,
  type AgentToolDefinition,
  type AgentToolExecution,
  type AgentToolSelection,
} from './tool-registry';

export interface AgentHarnessOptions<TContext = unknown> {
  /** Connection to one agent (or pass a ready {@link AgentHarnessClient} as `client`). */
  connection?: AgentHarnessConnectionConfig;
  client?: AgentHarnessClient;
  /** Existing tool registry to use (e.g. shared with a UI service); default: a new registry. */
  tools?: AgentToolRegistry<TContext>;
  /** Existing context registry to use; default: a new registry. */
  contextProviders?: AgentContextRegistry<TContext>;
  /** Default model (`default` = the agent's default model, or a `provider/model` id of the agent). */
  model?: string;
  /** Base instructions of the application, sent with every turn before the context sections. */
  instructions?: string;
  /** Report the agent's own workspace tool calls as `agent.activity` events (default false). */
  toolActivity?: boolean;
  /** Let the agent request several client tool calls at once (default true). */
  parallelToolCalls?: boolean;
  /** Maximum tool rounds per turn (default 32). */
  maxToolRounds?: number;
  /** Client tool calls executed concurrently within one round (default 4). */
  toolConcurrency?: number;
  /** Unexpected errors of tool handlers (the agent only sees a generic failure). */
  onToolError?: (error: unknown, call: AgentToolCallRequest) => void;
  /** Errors of context providers (the section is skipped). */
  onContextError?: (error: unknown, provider: string) => void;
}

export interface AgentTurnOptions<TContext = unknown> {
  /** Run context handed to tools, `enabled` checks and context providers (acting user, tenant, …). */
  context?: TContext;
  /**
   * Chat session of the turn: a `conv_…` id or chat session UUID. `primary` (default for {@link AgentHarness.run})
   * runs in the agent's primary session. Sessions ({@link AgentSession}) always use their own conversation.
   */
  conversationId?: string | 'primary';
  model?: string;
  /** Additional instructions for this turn only. */
  instructions?: string;
  /** Additional context sections for this turn only (`name → text or JSON value`). */
  contextSections?: Record<string, unknown>;
  /** Tools offered in this turn: a selection of the registry, or `false` for none. Default: all enabled tools. */
  tools?: AgentToolSelection | false;
  /** `auto` (default), `required`, `none` or a tool name the agent should call. */
  toolChoice?: 'auto' | 'required' | 'none' | { name: string };
  toolActivity?: boolean;
  parallelToolCalls?: boolean;
  /** Approval of calls to tools with `requiresApproval` (denied without a handler). */
  approve?: (request: AgentToolApprovalRequest<TContext>) => boolean | Promise<boolean>;
  metadata?: Record<string, string>;
  signal?: AbortSignal;
}

function toUsage(usage: AgentHarnessResponsesUsage | null | undefined): AgentTurnUsage {
  if (!usage) {
    return emptyUsage();
  }

  return {
    inputTokens: usage.input_tokens ?? 0,
    cachedInputTokens: usage.input_tokens_details?.cached_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    reasoningTokens: usage.output_tokens_details?.reasoning_tokens ?? 0,
    totalTokens: usage.total_tokens ?? 0,
  };
}

function addUsage(a: AgentTurnUsage, b: AgentTurnUsage): AgentTurnUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    reasoningTokens: a.reasoningTokens + b.reasoningTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}

function toActivity(item: AgentHarnessMcpCallItem): AgentActivity {
  return {
    id: item.id,
    name: item.name,
    arguments: item.arguments,
    output: item.output,
    error: item.error,
    status: item.status,
  };
}

function toSummary(execution: AgentToolExecution): AgentToolResultSummary {
  return {
    callId: execution.callId,
    name: execution.name,
    status: execution.status,
    output: execution.output,
    ...(execution.error ? { error: execution.error } : {}),
    durationMs: execution.durationMs,
  };
}

function toToolChoice(
  choice: AgentTurnOptions['toolChoice'],
  offered: AgentHarnessFunctionToolDefinition[],
): AgentHarnessToolChoice | undefined {
  if (choice === undefined || choice === 'auto') {
    return undefined;
  }

  if (choice === 'none' || choice === 'required') {
    return choice;
  }

  if (!offered.some((tool) => tool.name === choice.name)) {
    throw new AgentHarnessConfigError(`tool choice '${choice.name}' is not offered in this turn`);
  }

  return { type: 'function', name: choice.name };
}

/** Runs `tasks` with at most `limit` in flight, preserving order of results. */
async function mapWithConcurrency<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next++;

      results[index] = await task(items[index]);
    }
  });

  await Promise.all(workers);

  return results;
}

/** Simple FIFO lock: one turn per chat session at a time. */
class TurnLock {
  private tail: Promise<void> = Promise.resolve();

  async acquire(): Promise<() => void> {
    let release!: () => void;
    const previous = this.tail;

    this.tail = new Promise<void>((resolve) => (release = resolve));
    await previous;

    return release;
  }
}

/**
 * Mini-harness around one Agenstra agent's OpenAI-compatible API: function tools of the application, per-turn
 * context, conversations (chat sessions) and the client tool loop (Responses API with streaming).
 *
 * ```ts
 * const harness = new AgentHarness<{ userId: string }>({ connection: { apiUrl, clientId, agentId, credential } });
 *
 * harness.registerTool({
 *   name: 'get_invoice_total',
 *   description: 'Total of an invoice by number',
 *   parameters: { type: 'object', properties: { invoice: { type: 'string' } }, required: ['invoice'] },
 *   handler: ({ invoice }, { context }) => invoices.total(context.userId, invoice),
 * });
 *
 * const session = await harness.createSession({ title: 'Billing assistant', context: { userId } });
 * const result = await session.send('What is the total of INV-7?');
 * ```
 */
export class AgentHarness<TContext = unknown> {
  readonly client: AgentHarnessClient;
  readonly tools: AgentToolRegistry<TContext>;
  readonly contextProviders: AgentContextRegistry<TContext>;
  private readonly locks = new Map<string, { lock: TurnLock; users: number }>();

  constructor(readonly options: AgentHarnessOptions<TContext>) {
    this.tools = options.tools ?? new AgentToolRegistry<TContext>();
    this.contextProviders = options.contextProviders ?? new AgentContextRegistry<TContext>();

    if (options.client) {
      this.client = options.client;
    } else if (options.connection) {
      this.client = new AgentHarnessClient(options.connection);
    } else {
      throw new AgentHarnessConfigError('AgentHarness needs a connection or a client');
    }

    if (options.instructions !== undefined && typeof options.instructions !== 'string') {
      throw new AgentHarnessConfigError('instructions must be a string');
    }
  }

  registerTool<TArgs, TResult>(definition: AgentToolDefinition<TArgs, TContext, TResult>): () => void {
    return this.tools.register(definition);
  }

  registerContextProvider(provider: AgentContextProvider<TContext>): () => void {
    return this.contextProviders.register(provider);
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Conversations
  // -------------------------------------------------------------------------------------------------------------------

  createConversation(title?: string, signal?: AbortSignal): Promise<AgentHarnessConversation> {
    return this.client.createConversation(title ? { title: title.slice(0, 255) } : {}, { signal });
  }

  getConversation(conversationId: string, signal?: AbortSignal): Promise<AgentHarnessConversation> {
    return this.client.getConversation(conversationId, { signal });
  }

  renameConversation(conversationId: string, title: string, signal?: AbortSignal): Promise<AgentHarnessConversation> {
    return this.client.renameConversation(conversationId, title.slice(0, 255), { signal });
  }

  deleteConversation(conversationId: string, signal?: AbortSignal): Promise<void> {
    return this.client.deleteConversation(conversationId, { signal }).then(() => undefined);
  }

  /** All messages of a conversation, oldest first (user items without the harness instructions block). */
  async history(conversationId: string, signal?: AbortSignal): Promise<AgentHarnessConversationItem[]> {
    const items: AgentHarnessConversationItem[] = [];

    for await (const item of this.client.iterateConversationItems(conversationId, { order: 'asc' }, { signal })) {
      items.push(
        item.role === 'user'
          ? {
              ...item,
              content: item.content.map((part, index) =>
                index === 0 ? { ...part, text: stripHarnessInstructions(part.text) } : part,
              ),
            }
          : item,
      );
    }

    return items;
  }

  /** A session bound to an existing conversation. */
  session(conversationId: string, context?: TContext): AgentSession<TContext> {
    return new AgentSession(this, toConversationId(conversationId), context);
  }

  /** Creates a new conversation (chat session) and returns a session bound to it. */
  async createSession(params: { title?: string; context?: TContext; signal?: AbortSignal } = {}) {
    const conversation = await this.createConversation(params.title, params.signal);

    return new AgentSession(this, conversation.id, params.context);
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Turns
  // -------------------------------------------------------------------------------------------------------------------

  /** Runs one turn to completion (including client tool rounds). Throws on failure. */
  async run(message: string, options: AgentTurnOptions<TContext> = {}): Promise<AgentTurnResult> {
    let result: AgentTurnResult | undefined;

    for await (const event of this.turn(message, options)) {
      if (event.type === 'turn.completed') {
        result = event.result;
      }
    }

    if (!result) {
      throw new AgentHarnessApiError(502, 'The agent turn ended without a result', 'server_error');
    }

    return result;
  }

  /**
   * Streams one turn as {@link AgentHarnessEvent}s. Failures end the stream with a `turn.failed` event instead of
   * throwing (aborts included), which makes it suitable for relays.
   */
  async *stream(message: string, options: AgentTurnOptions<TContext> = {}): AsyncGenerator<AgentHarnessEvent> {
    try {
      yield* this.turn(message, options);
    } catch (error) {
      yield { type: 'turn.failed', error: describeError(error) };
    }
  }

  /** The turn as events; throws on failure (after which no further events follow). */
  async *turn(message: string, options: AgentTurnOptions<TContext> = {}): AsyncGenerator<AgentHarnessEvent> {
    if (typeof message !== 'string' || !message.trim()) {
      throw new AgentHarnessConfigError('The message must not be empty');
    }

    if (message.length > AGENT_HARNESS_MESSAGE_MAX_CHARS) {
      throw new AgentHarnessConfigError(`The message must be at most ${AGENT_HARNESS_MESSAGE_MAX_CHARS} characters`);
    }

    const conversation =
      options.conversationId && options.conversationId !== 'primary' ? toConversationId(options.conversationId) : null;
    const lockKey = conversation ?? 'primary';
    const release = await this.acquire(lockKey);

    try {
      yield* this.runTurn(message, conversation, options);
    } finally {
      release();
    }
  }

  private async acquire(key: string): Promise<() => void> {
    let entry = this.locks.get(key);

    if (!entry) {
      entry = { lock: new TurnLock(), users: 0 };
      this.locks.set(key, entry);
    }

    entry.users++;
    const release = await entry.lock.acquire();
    const current = entry;

    return () => {
      release();
      current.users--;

      if (current.users === 0 && this.locks.get(key) === current) {
        this.locks.delete(key);
      }
    };
  }

  private async *runTurn(
    message: string,
    conversationId: string | null,
    options: AgentTurnOptions<TContext>,
  ): AsyncGenerator<AgentHarnessEvent> {
    const context = options.context as TContext;
    const signal = options.signal;
    const model = options.model ?? this.options.model ?? AGENT_HARNESS_DEFAULT_MODEL;
    const toolActivity = options.toolActivity ?? this.options.toolActivity ?? false;
    const parallel = options.parallelToolCalls ?? this.options.parallelToolCalls ?? true;
    const maxRounds = Math.max(1, this.options.maxToolRounds ?? AGENT_HARNESS_DEFAULT_MAX_TOOL_ROUNDS);
    const offered =
      options.tools === false || options.toolChoice === 'none'
        ? []
        : await this.tools.offer(context, options.tools || {});
    const offeredNames = new Set(offered.map((tool) => tool.name));
    const toolChoice = offered.length > 0 ? toToolChoice(options.toolChoice, offered) : undefined;
    const instructions = await this.buildInstructions(context, options);
    const usage = { total: emptyUsage() };
    const activity = new Map<string, AgentActivity>();
    const toolCalls: AgentToolResultSummary[] = [];
    let chatId: string | null = conversationId ? toChatSessionId(conversationId) : null;
    let input: AgentHarnessResponseRequest['input'] = message;
    let totalCalls = 0;
    let budgetExhausted = false;
    // Calls the agent waits for whose outputs have not reached the controller yet (released on abort / early exit).
    let unanswered: AgentHarnessFunctionCallItem[] = [];
    const outputs = new Map<string, string>();

    try {
      for (let round = 1; ; round++) {
        if (signal?.aborted) {
          throw new AgentHarnessAbortError();
        }

        const request: AgentHarnessResponseRequest = {
          model,
          input,
          ...(round === 1 && instructions ? { instructions } : {}),
          ...(conversationId ? { conversation: conversationId } : chatId ? { chat_id: chatId } : {}),
          ...(offered.length > 0
            ? {
                tools: offered,
                ...(toolChoice ? { tool_choice: toolChoice } : {}),
                parallel_tool_calls: parallel,
              }
            : {}),
          ...(toolActivity ? { tool_activity: true } : {}),
          ...(round === 1 && options.metadata ? { metadata: options.metadata } : {}),
        };
        const stream = await this.client.streamResponse(request, { signal });

        // The controller accepted the outputs of the previous round.
        unanswered = [];
        outputs.clear();
        chatId = stream.chatId ?? chatId;
        yield {
          type: 'turn.started',
          conversationId: chatId ? toConversationId(chatId) : conversationId,
          chatId,
          round,
        };

        let final: AgentHarnessResponse | undefined;
        let roundText = '';

        for await (const event of stream) {
          switch (event.type) {
            case 'response.output_text.delta': {
              const delta = String((event as { delta?: unknown }).delta ?? '');

              roundText += delta;

              if (delta) {
                yield { type: 'text.delta', delta };
              }

              break;
            }

            case 'response.output_item.added':

            case 'response.output_item.done': {
              const item = (event as { item?: { type?: string } }).item;

              if (item?.type === 'mcp_call') {
                const entry = toActivity(item as AgentHarnessMcpCallItem);
                const previous = activity.get(entry.id);

                if (!previous || previous.status !== entry.status) {
                  activity.set(entry.id, entry);
                  yield { type: 'agent.activity', activity: entry };
                }
              }

              break;
            }

            case 'response.completed':
            case 'response.incomplete':
              final = (event as { response: AgentHarnessResponse }).response;
              break;

            case 'response.failed': {
              const failed = (event as { response?: AgentHarnessResponse }).response;

              throw new AgentHarnessApiError(
                502,
                failed?.error?.message ?? 'The agent turn failed',
                'server_error',
                failed?.error?.code ?? null,
              );
            }

            case 'error':
              throw AgentHarnessApiError.fromStreamEvent(event as Record<string, unknown>);
            default:
              break;
          }
        }

        if (!final) {
          if (signal?.aborted) {
            throw new AgentHarnessAbortError();
          }

          throw new AgentHarnessApiError(502, 'The agent stream ended unexpectedly', 'server_error');
        }

        usage.total = addUsage(usage.total, toUsage(final.usage));

        const calls = (final.output ?? []).filter(
          (item): item is AgentHarnessFunctionCallItem => item?.type === 'function_call',
        );

        if (calls.length === 0) {
          const text = final.output_text || roundText;

          yield { type: 'text.done', text };
          yield {
            type: 'turn.completed',
            result: {
              text,
              status: final.status === 'incomplete' ? 'incomplete' : 'completed',
              conversationId: chatId ? toConversationId(chatId) : conversationId,
              chatId,
              responseId: final.id ?? null,
              model,
              rounds: round,
              toolCalls,
              activity: [...activity.values()],
              usage: usage.total,
            },
          };

          return;
        }

        if (round > maxRounds + 1) {
          throw new AgentHarnessApiError(
            502,
            'The agent kept calling tools after the tool budget was exhausted',
            'server_error',
            'tool_budget_exhausted',
          );
        }

        unanswered = calls;

        for (const call of calls) {
          yield { type: 'tool.call', call: { callId: call.call_id, name: call.name, arguments: call.arguments } };
        }

        totalCalls += calls.length;
        budgetExhausted =
          budgetExhausted || round >= maxRounds || totalCalls > AGENT_HARNESS_TOOL_LIMITS.maxCallsPerTurn;

        const executions = budgetExhausted
          ? calls.map((call) => budgetExhaustedExecution(call))
          : await mapWithConcurrency(calls, parallel ? Math.max(1, this.options.toolConcurrency ?? 4) : 1, (call) =>
              this.tools.execute(
                { callId: call.call_id, name: call.name, arguments: call.arguments },
                {
                  context,
                  conversationId: chatId ? toConversationId(chatId) : conversationId,
                  signal,
                  offered: offeredNames,
                  approve: options.approve,
                  onError: this.options.onToolError,
                },
              ),
            );

        for (const execution of executions) {
          outputs.set(execution.callId, execution.output);
        }

        for (const execution of executions) {
          const summary = toSummary(execution);

          toolCalls.push(summary);
          yield { type: 'tool.result', result: summary };
        }

        input = executions.map(
          (execution): AgentHarnessResponseInputItem => ({
            type: 'function_call_output',
            call_id: execution.callId,
            output: execution.output,
          }),
        );
      }
    } finally {
      if (unanswered.length > 0) {
        await this.releaseCalls(unanswered, outputs, model, conversationId, chatId);
      }
    }
  }

  /**
   * Answers client tool calls the agent still waits for when the harness stops early (abort, consumer gone, error), so
   * the chat session is not blocked until the controller's result timeout. Outputs already computed are delivered, the
   * rest fail with `aborted`. The turn is then drained in the background: further calls of the agent are answered with
   * the same error (bounded rounds and time) until it finishes. Best effort: errors are ignored.
   */
  private releaseCalls(
    calls: AgentHarnessFunctionCallItem[],
    outputs: ReadonlyMap<string, string>,
    model: string,
    conversationId: string | null,
    chatId: string | null,
  ): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AGENT_HARNESS_RELEASE_TIMEOUT_MS);
    const cancelled = JSON.stringify({
      error: {
        message: 'The user cancelled this request. Do not call any tools again; reply that the request was cancelled.',
        code: 'aborted',
      },
    });
    const selector = conversationId ? { conversation: conversationId } : chatId ? { chat_id: chatId } : {};
    let pending: Array<{ callId: string; output: string }> = calls.map((call) => ({
      callId: call.call_id,
      output: outputs.get(call.call_id) ?? cancelled,
    }));

    // Node: never keep the process alive for a background drain.
    (timer as { unref?: () => void }).unref?.();

    const drain = async () => {
      for (let round = 0; round < AGENT_HARNESS_RELEASE_MAX_ROUNDS && pending.length > 0; round++) {
        const stream = await this.client.streamResponse(
          {
            model,
            input: pending.map((entry) => ({
              type: 'function_call_output' as const,
              call_id: entry.callId,
              output: entry.output,
            })),
            ...selector,
          },
          { signal: controller.signal },
        );
        let final: AgentHarnessResponse | undefined;

        for await (const event of stream) {
          if (event.type === 'response.completed' || event.type === 'response.incomplete') {
            final = (event as { response: AgentHarnessResponse }).response;
          }
        }

        pending = (final?.output ?? [])
          .filter((item): item is AgentHarnessFunctionCallItem => item?.type === 'function_call')
          .map((call) => ({ callId: call.call_id, output: cancelled }));
      }
    };

    // Detached: the caller's abort must not wait for the agent to finish.
    return Promise.resolve().then(() => {
      void drain()
        .catch(() => undefined)
        .finally(() => {
          clearTimeout(timer);
          controller.abort();
        });
    });
  }

  private async buildInstructions(context: TContext, options: AgentTurnOptions<TContext>): Promise<string> {
    const parts = [this.options.instructions, options.instructions]
      .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
      .map((part) => part.trim());
    const sections = await this.contextProviders.render(
      context,
      options.contextSections ?? {},
      this.options.onContextError,
    );

    if (sections) {
      parts.push(sections);
    }

    return parts.length > 0 ? wrapHarnessInstructions(parts.join('\n\n')) : '';
  }
}

function budgetExhaustedExecution(call: AgentHarnessFunctionCallItem): AgentToolExecution {
  const error = {
    message: 'Tool call limit of this turn reached: answer with the information you already have.',
    code: 'tool_budget_exhausted',
  };

  return {
    callId: call.call_id,
    name: call.name,
    arguments: call.arguments,
    status: 'failed',
    output: JSON.stringify({ error }),
    error,
    durationMs: 0,
  };
}

export function describeError(error: unknown): { message: string; code: string | null; status: number | null } {
  if (error instanceof AgentHarnessApiError) {
    return { message: error.message, code: error.code ?? error.type, status: error.status };
  }

  if (isAbortError(error)) {
    return { message: 'The agent turn was aborted', code: 'aborted', status: null };
  }

  if (error instanceof AgentHarnessConfigError) {
    return { message: error.message, code: 'invalid_request', status: 400 };
  }

  return { message: 'The agent turn failed', code: null, status: null };
}

/** A conversation (Agenstra chat session) with its run context; serializes its turns. */
export class AgentSession<TContext = unknown> {
  constructor(
    private readonly harness: AgentHarness<TContext>,
    readonly conversationId: string,
    private context?: TContext,
  ) {}

  get chatId(): string {
    return toChatSessionId(this.conversationId);
  }

  /** Replaces the run context used for subsequent turns (e.g. after the user navigated). */
  setContext(context: TContext): void {
    this.context = context;
  }

  send(message: string, options: Omit<AgentTurnOptions<TContext>, 'conversationId'> = {}): Promise<AgentTurnResult> {
    return this.harness.run(message, this.turnOptions(options));
  }

  stream(
    message: string,
    options: Omit<AgentTurnOptions<TContext>, 'conversationId'> = {},
  ): AsyncGenerator<AgentHarnessEvent> {
    return this.harness.stream(message, this.turnOptions(options));
  }

  history(signal?: AbortSignal): Promise<AgentHarnessConversationItem[]> {
    return this.harness.history(this.conversationId, signal);
  }

  rename(title: string, signal?: AbortSignal): Promise<AgentHarnessConversation> {
    return this.harness.renameConversation(this.conversationId, title, signal);
  }

  delete(signal?: AbortSignal): Promise<void> {
    return this.harness.deleteConversation(this.conversationId, signal);
  }

  private turnOptions(options: Omit<AgentTurnOptions<TContext>, 'conversationId'>): AgentTurnOptions<TContext> {
    return { ...options, context: options.context ?? this.context, conversationId: this.conversationId };
  }
}
