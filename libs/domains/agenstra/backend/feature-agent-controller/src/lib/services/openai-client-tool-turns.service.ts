import { randomUUID } from 'node:crypto';

import {
  CLIENT_TOOL_LIMITS,
  CLIENT_TOOL_WAIT_MS,
  type AgentClientToolRequest,
  type AgentClientToolResponse,
} from '@forepath/agenstra/shared/util-opencode-config';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';

import type { ChatOutputUsage } from '../utils/chat-output-usage.utils';
import { OpenAiApiError, toOpenAiError, type OpenAiErrorBody } from '../utils/openai-compatible-errors';

import { OpenAiCompatibleService, type OpenAiTurnParams } from './openai-compatible.service';
import { OpenAiTurnRelayStore, type ClientToolTurnBinding, type RelayedCallRecord } from './openai-turn-relay.store';
import { RemoteChatTurnAbortedError, type RemoteVisibleChatTurnParams } from './remote-agents-session.service';

export type { ClientToolTurnBinding } from './openai-turn-relay.store';

/** How long an API client may take to return a tool result (default 10 minutes). */
export const OPENAI_CLIENT_TOOL_RESULT_TIMEOUT_ENV = 'OPENAI_CLIENT_TOOL_RESULT_TIMEOUT_MS';

const DEFAULT_RESULT_TIMEOUT_MS = 600_000;
/** Concurrent agent calls arriving within this window are handed to the client together (parallel tool calls). */
const BATCH_WINDOW_MS = 200;
/** Manager acks are answered `pending` before the manager stops waiting (its ack timeout is the wait + 5 s). */
const ACK_HOLD_MS = CLIENT_TOOL_WAIT_MS - 3_000;
/** Finished turns stay resolvable this long (late requests get the buffered outcome / a clear error). */
const FINISHED_TURN_GRACE_MS = 60_000;
const RELAY_POLL_MS = 150;
/** A forwarding replica gives up when the owner does not accept the hand-off in time (owner gone). */
const RELAY_ACCEPT_TIMEOUT_MS = 15_000;

export function clientToolResultTimeoutMs(): number {
  const raw = Number(process.env[OPENAI_CLIENT_TOOL_RESULT_TIMEOUT_ENV]);

  return Number.isFinite(raw) && raw >= 10_000 && raw <= 3_600_000 ? raw : DEFAULT_RESULT_TIMEOUT_MS;
}

export interface ClientToolCall {
  callId: string;
  name: string;
  /** JSON-serialized arguments object. */
  arguments: string;
}

export interface ClientToolResultInput {
  callId: string;
  output: string;
}

/** Serializable outcome of a finished turn (crosses replicas). */
export interface ClientToolTurnResult {
  text: string;
  finishReason: 'stop' | 'content_filter';
  usage?: ChatOutputUsage;
  response?: unknown;
}

/** Updates of a client tool turn, in order; `tool_calls`, `final` and `error` end one request. */
export type ClientToolTurnUpdate =
  | { type: 'delta'; delta: string }
  | { type: 'tool_event'; event: { kind: 'toolCall' | 'toolResult'; payload: Record<string, unknown> } }
  | { type: 'tool_calls'; calls: ClientToolCall[] }
  | { type: 'final'; result: ClientToolTurnResult }
  | { type: 'error'; status: number; body: OpenAiErrorBody };

type RelayUpdate = ClientToolTurnUpdate | { type: 'accepted' };

interface RelayResumeMessage {
  type: 'resume';
  requestId: string;
  binding: ClientToolResumeBinding;
  results: ClientToolResultInput[];
}

export function isTerminalUpdate(update: ClientToolTurnUpdate): boolean {
  return update.type === 'tool_calls' || update.type === 'final' || update.type === 'error';
}

/** Consumer side of one request: updates until a terminal one (or `undefined` once closed). */
export interface ClientToolTurnHandle {
  readonly turnId: string;
  /** Chat session the turn runs in. */
  readonly chatId: string;
  next(): Promise<ClientToolTurnUpdate | undefined>;
  /** Stop consuming (client gone); the turn keeps running and buffers for the next request. */
  close(): void;
}

class UpdateChannel {
  private readonly items: ClientToolTurnUpdate[] = [];
  private waiting?: (update: ClientToolTurnUpdate | undefined) => void;
  closed = false;

  push(update: ClientToolTurnUpdate): void {
    if (this.closed) {
      return;
    }

    const waiting = this.waiting;

    if (waiting) {
      this.waiting = undefined;
      waiting(update);
    } else {
      this.items.push(update);
    }
  }

  next(): Promise<ClientToolTurnUpdate | undefined> {
    const item = this.items.shift();

    if (item) {
      return Promise.resolve(item);
    }

    if (this.closed) {
      return Promise.resolve(undefined);
    }

    return new Promise((resolve) => (this.waiting = resolve));
  }

  close(): void {
    this.closed = true;
    this.waiting?.(undefined);
    this.waiting = undefined;
  }
}

interface Hold {
  respond: (response: AgentClientToolResponse) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface CallState {
  call: ClientToolCall;
  /** Set for legacy turns: binding of the name index entry to remove once answered. */
  legacyBinding?: ClientToolTurnBinding;
  status: 'collecting' | 'delivered' | 'done';
  result?: AgentClientToolResponse;
  holds: Set<Hold>;
  expiry?: ReturnType<typeof setTimeout>;
}

/** Where a local turn's updates go: a request on this replica, or a request served by another replica. */
type TurnConsumer = { push(update: ClientToolTurnUpdate): void };

interface LocalTurn {
  id: string;
  binding: ClientToolTurnBinding;
  liveDeltas: boolean;
  toolActivity: boolean;
  consumer?: TurnConsumer;
  buffer: ClientToolTurnUpdate[];
  calls: Map<string, CallState>;
  batch: ClientToolCall[];
  batchTimer?: ReturnType<typeof setTimeout>;
  abort: AbortController;
  finished: boolean;
  legacy: boolean;
}

export interface StartClientToolTurnParams {
  binding: ClientToolTurnBinding;
  turn: Omit<OpenAiTurnParams, 'signal' | 'onDeltaText' | 'onToolEvent' | 'clientTools' | 'onClientToolRequest'>;
  clientTools: NonNullable<RemoteVisibleChatTurnParams['clientTools']>;
  /** Live text / tool events allowed (no rewriting outgoing message filter). */
  liveDeltas: boolean;
  toolActivity: boolean;
  /** Deprecated `functions` interface: results are matched by function name (one call at a time). */
  legacyFunctions?: boolean;
}

/** Continuation request: the chat is optional (call ids are random and bound to the principal) but must match. */
export type ClientToolResumeBinding = Omit<ClientToolTurnBinding, 'chatId'> & { chatId?: string };

function sameBinding(turn: ClientToolTurnBinding, request: ClientToolResumeBinding): boolean {
  return (
    turn.principal === request.principal &&
    turn.clientId === request.clientId &&
    turn.agentId === request.agentId &&
    (request.chatId === undefined || turn.chatId === request.chatId)
  );
}

function truncateOutput(output: string): string {
  return output.length > CLIENT_TOOL_LIMITS.outputMaxChars
    ? `${output.slice(0, CLIENT_TOOL_LIMITS.outputMaxChars)}… [truncated ${output.length - CLIENT_TOOL_LIMITS.outputMaxChars} characters]`
    : output;
}

const notPendingError = () =>
  OpenAiApiError.notFound(
    'No pending tool call matches the tool results (unknown, already answered or expired).',
    'tool_call_not_found',
    'tool_call_id',
  );

/**
 * Client tool turns of the OpenAI-compatible API: a chat turn that pauses whenever the agent calls a client tool
 * (handed to the API client as `tool_calls`) and continues with the results of the client's next request.
 *
 * The turn runs on the API replica that started it (agent-manager socket). Continuations are bound to the same
 * principal, workspace, agent and chat session; other replicas forward them through {@link OpenAiTurnRelayStore}.
 */
@Injectable()
export class OpenAiClientToolTurnsService implements OnModuleDestroy {
  private readonly logger = new Logger(OpenAiClientToolTurnsService.name);
  private readonly turns = new Map<string, LocalTurn>();
  /** callId → turnId of local turns. */
  private readonly callIndex = new Map<string, string>();
  private relayPump?: ReturnType<typeof setInterval>;

  constructor(
    private readonly openAi: OpenAiCompatibleService,
    private readonly relay: OpenAiTurnRelayStore,
  ) {}

  onModuleDestroy(): void {
    clearInterval(this.relayPump);

    for (const turn of this.turns.values()) {
      clearTimeout(turn.batchTimer);

      for (const state of turn.calls.values()) {
        this.complete(state, { ok: true, status: 'failed', error: 'The service is shutting down' });
      }

      turn.abort.abort();
    }
  }

  /** Start a client tool turn; the handle yields updates until the first `tool_calls` / `final` / `error`. */
  start(params: StartClientToolTurnParams): ClientToolTurnHandle {
    const turn: LocalTurn = {
      id: randomUUID(),
      binding: params.binding,
      liveDeltas: params.liveDeltas,
      toolActivity: params.toolActivity,
      buffer: [],
      calls: new Map(),
      batch: [],
      abort: new AbortController(),
      finished: false,
      legacy: params.legacyFunctions === true,
    };

    this.turns.set(turn.id, turn);
    const handle = this.attachLocal(turn);

    void this.openAi
      .runTurn({
        ...params.turn,
        signal: turn.abort.signal,
        clientTools: params.clientTools,
        onDeltaText: turn.liveDeltas ? (delta) => this.emit(turn, { type: 'delta', delta }) : undefined,
        onToolEvent:
          turn.liveDeltas && turn.toolActivity ? (event) => this.emit(turn, { type: 'tool_event', event }) : undefined,
        onClientToolRequest: (request, respond) => this.onClientToolRequest(turn, request, respond),
      })
      .then(
        (result) =>
          this.finish(turn, {
            type: 'final',
            result: {
              text: result.text,
              finishReason: result.finishReason,
              usage: result.usage,
              response: result.response,
            },
          }),
        (error: unknown) => {
          if (error instanceof RemoteChatTurnAbortedError) {
            this.finish(turn, { type: 'error', ...this.errorOf(OpenAiApiError.notFound('The tool call turn ended.')) });

            return;
          }

          this.finish(turn, { type: 'error', ...this.errorOf(error) });
        },
      );

    return handle;
  }

  /**
   * Continue a paused turn with the client's tool results. Throws an OpenAI error when no pending call matches (also
   * for calls of other principals / chats, which are indistinguishable from unknown ones).
   */
  async resume(binding: ClientToolResumeBinding, results: ClientToolResultInput[]): Promise<ClientToolTurnHandle> {
    if (results.length === 0) {
      throw notPendingError();
    }

    const localTurnId = this.callIndex.get(results[0].callId);
    const local = localTurnId ? this.turns.get(localTurnId) : undefined;

    if (local) {
      if (!sameBinding(local.binding, binding)) {
        throw notPendingError();
      }

      this.submitResults(local, results);

      return this.attachLocal(local);
    }

    const record = await this.relay.lookupCall(results[0].callId);

    if (!record || record.owner === this.relay.instanceId || !sameBinding(record.binding, binding)) {
      throw notPendingError();
    }

    return this.forwardToOwner(record, binding, results);
  }

  /** Call id of the pending legacy function call `name` of this binding (deprecated `functions` interface). */
  async resolveLegacyCallId(binding: ClientToolTurnBinding, name: string): Promise<string | undefined> {
    for (const turn of this.turns.values()) {
      if (!turn.finished && turn.legacy && sameBinding(turn.binding, binding)) {
        for (const state of turn.calls.values()) {
          if (state.status === 'delivered' && state.call.name === name) {
            return state.call.callId;
          }
        }
      }
    }

    return (await this.relay.lookupLegacyCall(binding, name)) ?? undefined;
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Owner side
  // -------------------------------------------------------------------------------------------------------------------

  private attachLocal(turn: LocalTurn): ClientToolTurnHandle {
    const channel = new UpdateChannel();
    const consumer: TurnConsumer = {
      push: (update) => {
        channel.push(update);

        if (isTerminalUpdate(update)) {
          channel.close();
        }
      },
    };

    this.attach(turn, consumer);

    return {
      turnId: turn.id,
      chatId: turn.binding.chatId,
      next: () => channel.next(),
      close: () => {
        channel.close();

        if (turn.consumer === consumer) {
          turn.consumer = undefined;
        }
      },
    };
  }

  /** New consumer of a turn; buffered updates (produced while nobody listened) are replayed first. */
  private attach(turn: LocalTurn, consumer: TurnConsumer): void {
    turn.consumer = consumer;

    while (turn.buffer.length > 0 && turn.consumer === consumer) {
      this.deliver(turn, turn.buffer.shift() as ClientToolTurnUpdate);
    }
  }

  private emit(turn: LocalTurn, update: ClientToolTurnUpdate): void {
    if (turn.consumer) {
      this.deliver(turn, update);
    } else {
      turn.buffer.push(update);
    }
  }

  private deliver(turn: LocalTurn, update: ClientToolTurnUpdate): void {
    const consumer = turn.consumer as TurnConsumer;

    if (isTerminalUpdate(update)) {
      // One request ends with a terminal update; the next request attaches anew.
      turn.consumer = undefined;
    }

    consumer.push(update);
  }

  private onClientToolRequest(
    turn: LocalTurn,
    request: AgentClientToolRequest,
    respond: (response: AgentClientToolResponse) => void,
  ): void {
    if (turn.finished) {
      respond({ ok: false, error: 'The request has ended' });

      return;
    }

    const existing = turn.calls.get(request.callId);

    if (request.op === 'wait' || existing) {
      if (!existing) {
        respond({ ok: true, status: 'failed', error: 'Unknown client tool call' });
      } else if (existing.result) {
        respond(existing.result);
      } else {
        this.hold(existing, respond);
      }

      return;
    }

    const state: CallState = {
      call: { callId: request.callId, name: request.name, arguments: request.arguments },
      status: 'collecting',
      holds: new Set(),
      ...(turn.legacy ? { legacyBinding: turn.binding } : {}),
    };

    turn.calls.set(request.callId, state);
    this.callIndex.set(request.callId, turn.id);
    this.hold(state, respond);
    turn.batch.push(state.call);

    if (!turn.batchTimer) {
      turn.batchTimer = setTimeout(() => this.flushBatch(turn), BATCH_WINDOW_MS);
      turn.batchTimer.unref?.();
    }
  }

  /** Answer the manager when the result arrives, or `pending` before its ack timeout. */
  private hold(state: CallState, respond: (response: AgentClientToolResponse) => void): void {
    const hold: Hold = {
      respond,
      timer: setTimeout(() => {
        state.holds.delete(hold);
        respond({ ok: true, status: 'pending' });
      }, ACK_HOLD_MS),
    };

    hold.timer.unref?.();

    state.holds.add(hold);
  }

  private flushBatch(turn: LocalTurn): void {
    turn.batchTimer = undefined;
    const calls = turn.batch.splice(0);

    if (calls.length === 0 || turn.finished) {
      return;
    }

    const timeoutMs = clientToolResultTimeoutMs();
    const ttlSeconds = Math.ceil((timeoutMs + FINISHED_TURN_GRACE_MS) / 1000);

    for (const call of calls) {
      const state = turn.calls.get(call.callId) as CallState;

      state.status = 'delivered';
      state.expiry = setTimeout(
        () =>
          this.complete(state, {
            ok: true,
            status: 'failed',
            error: 'The API client did not return a result for this tool call in time',
          }),
        timeoutMs,
      );
      state.expiry.unref?.();
      void this.relay.registerCall(
        call.callId,
        { turnId: turn.id, owner: this.relay.instanceId, binding: turn.binding } satisfies RelayedCallRecord,
        ttlSeconds,
      );

      if (turn.legacy) {
        void this.relay.registerLegacyCall(turn.binding, call.name, call.callId, ttlSeconds);
      }
    }

    this.emit(turn, { type: 'tool_calls', calls });
    this.ensureRelayPump();
  }

  private submitResults(turn: LocalTurn, results: ClientToolResultInput[]): void {
    const states = results.map((result) => turn.calls.get(result.callId));

    if (states.some((state) => !state || state.status !== 'delivered')) {
      throw notPendingError();
    }

    results.forEach((result, index) =>
      this.complete(states[index] as CallState, {
        ok: true,
        status: 'completed',
        output: truncateOutput(result.output),
      }),
    );
  }

  private complete(state: CallState, result: AgentClientToolResponse): void {
    if (state.status === 'done') {
      return;
    }

    state.status = 'done';
    state.result = result;
    clearTimeout(state.expiry);
    void this.relay.deleteCall(state.call.callId);

    if (state.legacyBinding) {
      void this.relay.deleteLegacyCall(state.legacyBinding, state.call.name);
    }

    for (const hold of state.holds) {
      clearTimeout(hold.timer);
      hold.respond(result);
    }

    state.holds.clear();
  }

  private finish(turn: LocalTurn, update: ClientToolTurnUpdate): void {
    if (turn.finished) {
      return;
    }

    turn.finished = true;
    clearTimeout(turn.batchTimer);
    this.emit(turn, update);

    for (const state of turn.calls.values()) {
      this.complete(state, { ok: true, status: 'failed', error: 'The request has ended' });
    }

    setTimeout(() => this.forget(turn), FINISHED_TURN_GRACE_MS).unref?.();
  }

  private forget(turn: LocalTurn): void {
    this.turns.delete(turn.id);

    for (const callId of turn.calls.keys()) {
      this.callIndex.delete(callId);
    }
  }

  private errorOf(error: unknown): { status: number; body: OpenAiErrorBody } {
    return toOpenAiError(error);
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Cross-replica relay
  // -------------------------------------------------------------------------------------------------------------------

  /** Poll the inboxes of local turns that wait for client results (only while such turns exist). */
  private ensureRelayPump(): void {
    if (this.relayPump || !this.relay.isEnabled()) {
      return;
    }

    this.relayPump = setInterval(() => void this.pumpInboxes(), RELAY_POLL_MS);
    this.relayPump.unref?.();
  }

  private async pumpInboxes(): Promise<void> {
    const waiting = [...this.turns.values()].filter(
      (turn) => !turn.finished && [...turn.calls.values()].some((state) => state.status === 'delivered'),
    );

    if (waiting.length === 0) {
      clearInterval(this.relayPump);
      this.relayPump = undefined;

      return;
    }

    for (const turn of waiting) {
      for (const message of await this.relay.pullInbox<RelayResumeMessage>(turn.id)) {
        this.acceptRelayedResume(turn, message);
      }
    }
  }

  private acceptRelayedResume(turn: LocalTurn, message: RelayResumeMessage): void {
    if (message?.type !== 'resume' || typeof message.requestId !== 'string') {
      return;
    }

    const ttlSeconds = Math.ceil((clientToolResultTimeoutMs() + FINISHED_TURN_GRACE_MS) / 1000);
    const send = (update: RelayUpdate) => void this.relay.pushOutbox(turn.id, message.requestId, update, ttlSeconds);

    try {
      if (!sameBinding(turn.binding, message.binding)) {
        throw notPendingError();
      }

      this.submitResults(turn, message.results ?? []);
    } catch (error) {
      send({ type: 'error', ...this.errorOf(error) });

      return;
    }

    send({ type: 'accepted' });
    this.attach(turn, { push: (update) => send(update) });
  }

  /** Serve a continuation whose turn lives on another replica: hand off the results, relay the updates back. */
  private async forwardToOwner(
    record: RelayedCallRecord,
    binding: ClientToolResumeBinding,
    results: ClientToolResultInput[],
  ): Promise<ClientToolTurnHandle> {
    const requestId = randomUUID();
    const ttlSeconds = Math.ceil((clientToolResultTimeoutMs() + FINISHED_TURN_GRACE_MS) / 1000);

    if (
      !(await this.relay.pushInbox(
        record.turnId,
        { type: 'resume', requestId, binding, results } satisfies RelayResumeMessage,
        ttlSeconds,
      ))
    ) {
      throw notPendingError();
    }

    const channel = new UpdateChannel();
    let accepted = false;
    const startedAt = Date.now();
    const poll = async (): Promise<void> => {
      while (!channel.closed) {
        const updates = await this.relay.pullOutbox<RelayUpdate>(record.turnId, requestId);

        for (const update of updates) {
          if (update.type === 'accepted') {
            accepted = true;
            continue;
          }

          channel.push(update);

          if (isTerminalUpdate(update)) {
            channel.close();

            return;
          }
        }

        if (!accepted && Date.now() - startedAt > RELAY_ACCEPT_TIMEOUT_MS) {
          channel.push({ type: 'error', ...this.errorOf(notPendingError()) });
          channel.close();

          return;
        }

        await new Promise((resolve) => setTimeout(resolve, RELAY_POLL_MS).unref?.());
      }
    };

    void poll().catch((error: unknown) => {
      this.logger.warn(`Relayed tool call turn failed: ${(error as Error).message}`);
      channel.push({ type: 'error', ...this.errorOf(error) });
      channel.close();
    });

    return {
      turnId: record.turnId,
      chatId: record.binding.chatId,
      next: () => channel.next(),
      close: () => channel.close(),
    };
  }
}
