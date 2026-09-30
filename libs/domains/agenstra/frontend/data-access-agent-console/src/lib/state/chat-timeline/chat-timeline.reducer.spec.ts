import { ChatActor } from '../container-socket/container-socket.types';

import {
  chatTimelineAutomationUpsert,
  chatTimelineBatchReceived,
  chatTimelineClear,
  chatTimelineMessageReceived,
  chatTimelineRestoreRequested,
} from './chat-timeline.actions';
import { chatTimelineReducer, initialChatTimelineState, type ChatTimelineState } from './chat-timeline.reducer';
import type { ChatTimelineBatchMessage } from './chat-timeline.types';

describe('chatTimelineReducer', () => {
  const chatId = 'chat-1';

  function userMessage(
    overrides: Partial<ChatTimelineBatchMessage> & { id?: string; text?: string } = {},
  ): ChatTimelineBatchMessage {
    return {
      from: ChatActor.USER,
      text: overrides.text ?? 'hello',
      timestamp: overrides.timestamp ?? new Date(1000).toISOString(),
      chatId,
      ...overrides,
    } as ChatTimelineBatchMessage;
  }

  it('returns initial state for unknown action', () => {
    const state = chatTimelineReducer(undefined, { type: 'UNKNOWN' } as never);

    expect(state).toEqual(initialChatTimelineState);
  });

  it('clears timeline to initial state', () => {
    const prev: ChatTimelineState = {
      ...initialChatTimelineState,
      messages: [
        {
          id: 'm1',
          event: 'chatMessage',
          payload: { success: true, data: userMessage({ id: 'm1' }), timestamp: new Date(1000).toISOString() },
          timestamp: 1000,
          chatId,
        },
      ],
      hasMoreOlder: true,
      oldestMessageId: 'm1',
      loadingOlder: true,
      chatEnhancementPendingCorrelationId: 'c1',
    };

    const state = chatTimelineReducer(prev, chatTimelineClear());

    expect(state).toEqual(initialChatTimelineState);
  });

  it('sets loadingInitial or loadingOlder on restore requested', () => {
    const initial = chatTimelineReducer(initialChatTimelineState, chatTimelineRestoreRequested({ older: false }));
    const older = chatTimelineReducer(initialChatTimelineState, chatTimelineRestoreRequested({ older: true }));

    expect(initial.loadingInitial).toBe(true);
    expect(initial.loadingOlder).toBe(false);
    expect(older.loadingInitial).toBe(false);
    expect(older.loadingOlder).toBe(true);
  });

  it('replaces messages, events, and filters when replace is true', () => {
    const prev: ChatTimelineState = {
      ...initialChatTimelineState,
      messages: [
        {
          id: 'old',
          event: 'chatMessage',
          payload: {
            success: true,
            data: userMessage({ id: 'old', text: 'old' }),
            timestamp: new Date(1).toISOString(),
          },
          timestamp: 1,
          chatId,
        },
      ],
      filterResults: [
        {
          direction: 'outgoing',
          status: 'allowed',
          message: 'x',
          appliedFilters: [],
          timestamp: 1,
          receivedAt: 1,
        },
      ],
    };

    const state = chatTimelineReducer(
      prev,
      chatTimelineBatchReceived({
        chatId,
        messages: [
          userMessage({ id: 'm1', text: 'new' }),
          userMessage({ id: 'm2', text: 'newer', timestamp: new Date(2000).toISOString() }),
        ],
        filterResults: [
          {
            direction: 'incoming',
            status: 'filtered',
            message: 'hi',
            appliedFilters: [],
            timestamp: new Date(1500).toISOString(),
          },
        ],
        events: [
          {
            success: true,
            data: {
              eventId: 'e1',
              agentId: 'a1',
              correlationId: 'c1',
              sequence: 1,
              timestamp: new Date(1500).toISOString(),
              kind: 'status',
              payload: {},
              chatId,
            },
            timestamp: new Date(1500).toISOString(),
          },
        ],
        hasMoreOlder: true,
        replace: true,
        oldestMessageId: 'm1',
      }),
    );

    expect(state.messages).toHaveLength(2);
    expect(state.messages.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(state.messages[0]?.payload.data).toMatchObject({ text: 'new' });
    expect(state.events).toHaveLength(1);
    expect(state.filterResults).toHaveLength(1);
    expect(state.filterResults[0]?.status).toBe('filtered');
    expect(state.hasMoreOlder).toBe(true);
    expect(state.oldestMessageId).toBe('m1');
    expect(state.loadingInitial).toBe(false);
  });

  it('prepends messages by id and dedupes when replace is false', () => {
    const prev = chatTimelineReducer(
      initialChatTimelineState,
      chatTimelineBatchReceived({
        chatId,
        messages: [userMessage({ id: 'm2', text: 'mid', timestamp: new Date(2000).toISOString() })],
        hasMoreOlder: true,
        replace: true,
        oldestMessageId: 'm2',
      }),
    );

    const state = chatTimelineReducer(
      prev,
      chatTimelineBatchReceived({
        chatId,
        messages: [
          userMessage({ id: 'm1', text: 'older', timestamp: new Date(1000).toISOString() }),
          userMessage({ id: 'm2', text: 'dup', timestamp: new Date(2000).toISOString() }),
        ],
        hasMoreOlder: false,
        replace: false,
        oldestMessageId: 'm1',
      }),
    );

    expect(state.messages.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(state.messages.find((m) => m.id === 'm2')?.payload.data).toMatchObject({ text: 'mid' });
    expect(state.hasMoreOlder).toBe(false);
    expect(state.oldestMessageId).toBe('m1');
  });

  it('appends or upserts live messages by id', () => {
    let state = chatTimelineReducer(
      initialChatTimelineState,
      chatTimelineMessageReceived({
        payload: {
          success: true,
          data: userMessage({ id: 'm1', text: 'first' }),
          timestamp: new Date(1000).toISOString(),
        },
        chatId,
      }),
    );

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]?.payload.data).toMatchObject({ text: 'first' });

    state = chatTimelineReducer(
      state,
      chatTimelineMessageReceived({
        payload: {
          success: true,
          data: userMessage({ id: 'm1', text: 'updated' }),
          timestamp: new Date(1000).toISOString(),
        },
        chatId,
      }),
    );

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]?.payload.data).toMatchObject({ text: 'updated' });

    state = chatTimelineReducer(
      state,
      chatTimelineMessageReceived({
        payload: {
          success: true,
          data: userMessage({ id: 'm2', text: 'second', timestamp: new Date(2000).toISOString() }),
          timestamp: new Date(2000).toISOString(),
        },
        chatId,
      }),
    );

    expect(state.messages.map((m) => m.id)).toEqual(['m1', 'm2']);
  });

  it('dedupes automations by run.id', () => {
    const basePayload = {
      timelineAt: new Date(500).toISOString(),
      hydrate: false,
      ticket: {
        id: 't1',
        clientId: 'c1',
        title: 'T',
        priority: 'medium',
        status: 'todo',
        automationEligible: true,
        preferredChatAgentId: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      run: {
        id: 'r1',
        ticketId: 't1',
        clientId: 'c1',
        agentId: 'a1',
        status: 'running',
        phase: 'iterate',
        startedAt: new Date(500).toISOString(),
        updatedAt: new Date(500).toISOString(),
        finishedAt: null,
      },
      actions: [],
    };

    let state = chatTimelineReducer(initialChatTimelineState, chatTimelineAutomationUpsert({ payload: basePayload }));

    state = chatTimelineReducer(
      state,
      chatTimelineAutomationUpsert({
        payload: {
          ...basePayload,
          timelineAt: new Date(800).toISOString(),
          run: { ...basePayload.run, status: 'succeeded', updatedAt: new Date(800).toISOString() },
        },
      }),
    );

    expect(state.automations).toHaveLength(1);
    expect(state.automations[0]?.payload.run.status).toBe('succeeded');
  });
});
