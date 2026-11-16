import type { AgentTurnResult } from '@forepath/shared/shared/util-agent-harness';

import {
  agentTurnEvent,
  agentTurnStreamFailure,
  cancelAgentTurn,
  createAgentConversationSuccess,
  loadAgentConversationHistorySuccess,
  openAgentConversation,
  sendAgentMessage,
} from './agent-harness.actions';
import { agentHarnessReducer, initialAgentHarnessState, type AgentHarnessState } from './agent-harness.reducer';

const CONV = 'conv_33333333333343338333333333333333';

function result(overrides: Partial<AgentTurnResult> = {}): AgentTurnResult {
  return {
    text: 'Done',
    status: 'completed',
    conversationId: CONV,
    chatId: null,
    responseId: 'resp_1',
    model: 'default',
    rounds: 2,
    toolCalls: [{ callId: 'c1', name: 'book', status: 'completed', durationMs: 1 }],
    activity: [],
    usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, reasoningTokens: 0, totalTokens: 2 },
    ...overrides,
  };
}

function reduce(state: AgentHarnessState, ...actions: Parameters<typeof agentHarnessReducer>[1][]): AgentHarnessState {
  return actions.reduce((current, action) => agentHarnessReducer(current, action), state);
}

describe('agentHarnessReducer', () => {
  it('opens a conversation and loads its history', () => {
    const state = reduce(
      initialAgentHarnessState,
      openAgentConversation({ conversationId: CONV }),
      loadAgentConversationHistorySuccess({
        conversationId: CONV,
        items: [
          {
            type: 'message',
            id: 'msg_1',
            status: 'completed',
            role: 'user',
            content: [{ type: 'input_text', text: 'Hi' }],
            created_at: 1,
          },
          {
            type: 'message',
            id: 'msg_2',
            status: 'incomplete',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Dropped' }],
            created_at: 2,
          },
        ],
      }),
    );

    expect(state.loading).toBe(false);
    expect(state.messages).toEqual([
      { id: 'msg_1', role: 'user', text: 'Hi', status: 'completed', createdAt: 1 },
      { id: 'msg_2', role: 'assistant', text: 'Dropped', status: 'incomplete', createdAt: 2 },
    ]);
  });

  it('ignores history of a conversation that is no longer open', () => {
    const state = reduce(
      initialAgentHarnessState,
      openAgentConversation({ conversationId: CONV }),
      loadAgentConversationHistorySuccess({ conversationId: 'conv_other', items: [] }),
    );

    expect(state.loading).toBe(true);
  });

  it('tracks a streamed turn with tool calls', () => {
    const state = reduce(
      { ...initialAgentHarnessState, conversationId: CONV },
      sendAgentMessage({ text: 'Book it', localId: 'l1', createdAt: 5 }),
      agentTurnEvent({ event: { type: 'turn.started', conversationId: CONV, chatId: null, round: 1 } }),
      agentTurnEvent({ event: { type: 'text.delta', delta: 'Work' } }),
      agentTurnEvent({ event: { type: 'text.delta', delta: 'ing' } }),
      agentTurnEvent({ event: { type: 'tool.call', call: { callId: 'c1', name: 'book' } } }),
    );

    expect(state.sending).toBe(true);
    expect(state.messages.map((message) => [message.role, message.text, message.status])).toEqual([
      ['user', 'Book it', 'completed'],
      ['assistant', 'Working', 'streaming'],
    ]);
    expect(state.toolCalls).toEqual([{ callId: 'c1', name: 'book', status: 'running' }]);

    const done = reduce(
      state,
      agentTurnEvent({
        event: {
          type: 'tool.result',
          result: {
            callId: 'c1',
            name: 'book',
            status: 'denied',
            error: { message: 'No', code: 'not_approved' },
            durationMs: 1,
          },
        },
      }),
      agentTurnEvent({ event: { type: 'turn.completed', result: result() } }),
    );

    expect(done.sending).toBe(false);
    expect(done.toolCalls).toEqual([{ callId: 'c1', name: 'book', status: 'denied', error: 'No' }]);
    expect(done.messages[1]).toEqual(
      expect.objectContaining({ id: 'assistant-resp_1', text: 'Done', status: 'completed' }),
    );
    expect(done.lastTurn).toEqual({ rounds: 2, usage: result().usage, toolCalls: 1 });
  });

  it('adopts the conversation reported by the first turn', () => {
    const state = reduce(
      initialAgentHarnessState,
      sendAgentMessage({ text: 'Hi', localId: 'l1', createdAt: 5 }),
      agentTurnEvent({ event: { type: 'turn.started', conversationId: CONV, chatId: null, round: 1 } }),
    );

    expect(state.conversationId).toBe(CONV);
  });

  it('marks failed and cancelled turns', () => {
    const failed = reduce(
      initialAgentHarnessState,
      sendAgentMessage({ text: 'Hi', localId: 'l1', createdAt: 5 }),
      agentTurnStreamFailure({ error: 'boom' }),
    );

    expect(failed.error).toBe('boom');
    expect(failed.messages[0].status).toBe('failed');

    const cancelled = reduce(
      initialAgentHarnessState,
      sendAgentMessage({ text: 'Hi', localId: 'l1', createdAt: 5 }),
      agentTurnEvent({ event: { type: 'text.delta', delta: 'x' } }),
      cancelAgentTurn(),
    );

    expect(cancelled.sending).toBe(false);
    expect(cancelled.messages[1].status).toBe('incomplete');
    expect(cancelled.messages[1].id).not.toBe('assistant-streaming');
  });

  it('starts fresh on a created conversation', () => {
    const state = reduce(
      {
        ...initialAgentHarnessState,
        messages: [{ id: 'x', role: 'user', text: 'old', status: 'completed', createdAt: 1 }],
      },
      createAgentConversationSuccess({
        conversation: { id: CONV, object: 'conversation', created_at: 1, metadata: { agenstra_chat_id: 'x' } },
      }),
    );

    expect(state).toEqual({ ...initialAgentHarnessState, conversationId: CONV });
  });
});
