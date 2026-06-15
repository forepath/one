import { CLIENT_CHAT_AUTOMATION_SOCKET_EVENT } from './client-chat-automation.constants';
import { selectChatTimelineOrdered } from './sockets.selectors';
import type { ForwardedEventPayload } from './sockets.types';

describe('selectChatTimelineOrdered', () => {
  it('orders chat and automation by semantic timestamp and dedupes automation by run id', () => {
    const chatPayload: ForwardedEventPayload = {
      success: true,
      data: { from: 'user', text: 'hi', timestamp: new Date(1000).toISOString() },
      timestamp: new Date(1000).toISOString(),
    } as ForwardedEventPayload;
    const autoPayload = {
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
    const autoPayload2 = {
      ...autoPayload,
      timelineAt: new Date(800).toISOString(),
      run: { ...autoPayload.run, status: 'succeeded', updatedAt: new Date(800).toISOString() },
    };
    const state = {
      forwardedEvents: [
        { event: 'chatMessage', payload: chatPayload, timestamp: 999 },
        { event: CLIENT_CHAT_AUTOMATION_SOCKET_EVENT, payload: autoPayload, timestamp: 501 },
        { event: CLIENT_CHAT_AUTOMATION_SOCKET_EVENT, payload: autoPayload2, timestamp: 802 },
      ],
      selectedAgentId: 'a1',
    } as never;
    const out = selectChatTimelineOrdered.projector(state.forwardedEvents as never, state.selectedAgentId);

    expect(out.map((r) => r.event)).toEqual([CLIENT_CHAT_AUTOMATION_SOCKET_EVENT, 'chatMessage']);
    expect((out[0]?.payload as typeof autoPayload2).run.status).toBe('succeeded');
  });

  it('filters automation when selected agent does not match', () => {
    const autoPayload = {
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
        agentId: 'other',
        status: 'running',
        phase: 'iterate',
        startedAt: new Date(500).toISOString(),
        updatedAt: new Date(500).toISOString(),
        finishedAt: null,
      },
      actions: [],
    };
    const out = selectChatTimelineOrdered.projector(
      [
        { event: CLIENT_CHAT_AUTOMATION_SOCKET_EVENT, payload: autoPayload, timestamp: 1, semanticTimestamp: 1 },
      ] as never,
      'a1',
    );

    expect(out).toHaveLength(0);
  });
});
