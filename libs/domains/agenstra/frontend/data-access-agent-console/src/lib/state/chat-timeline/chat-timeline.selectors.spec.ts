import { CLIENT_CHAT_AUTOMATION_SOCKET_EVENT } from '../container-socket/client-chat-automation.constants';
import { ChatActor, type ForwardedEventPayload } from '../container-socket/container-socket.types';

import { selectChatTimelineOrdered } from './chat-timeline.selectors';
import type { ChatTimelineAutomationRow, ChatTimelineMessageRow } from './chat-timeline.types';

const primarySession = {
  id: 'chat-primary',
  agentId: 'a1',
  title: 'Chat',
  kind: 'primary' as const,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const userSession = {
  id: 'chat-user',
  agentId: 'a1',
  title: 'Side',
  kind: 'user' as const,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const sessionsMap = {
  'c1:a1': [primarySession, userSession],
};

function chatMessageRow(
  text: string,
  timestampMs: number,
  chatId?: string,
  id: string | null = 'm1',
): ChatTimelineMessageRow {
  const timestamp = new Date(timestampMs).toISOString();
  const payload = {
    success: true as const,
    data: {
      from: ChatActor.USER,
      text,
      timestamp,
      ...(chatId ? { chatId } : {}),
    },
    timestamp,
  };

  return {
    id,
    event: 'chatMessage',
    payload,
    timestamp: timestampMs,
    ...(chatId ? { chatId } : {}),
  };
}

function automationRow(agentId: string, timelineAtMs: number, status = 'running'): ChatTimelineAutomationRow {
  return {
    event: CLIENT_CHAT_AUTOMATION_SOCKET_EVENT,
    timestamp: timelineAtMs,
    payload: {
      timelineAt: new Date(timelineAtMs).toISOString(),
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
        agentId,
        status,
        phase: 'iterate',
        startedAt: new Date(timelineAtMs).toISOString(),
        updatedAt: new Date(timelineAtMs).toISOString(),
        finishedAt: null,
      },
      actions: [],
    },
  };
}

describe('selectChatTimelineOrdered', () => {
  it('orders chat and automation by semantic timestamp and dedupes automation by run id', () => {
    const messages = [chatMessageRow('hi', 1000)];
    const automations = [automationRow('a1', 500, 'running'), automationRow('a1', 800, 'succeeded')];
    const out = selectChatTimelineOrdered.projector(messages, automations, 'a1', 'c1', { 'c1:a1': null }, sessionsMap);

    expect(out.map((r) => r.event)).toEqual([CLIENT_CHAT_AUTOMATION_SOCKET_EVENT, 'chatMessage']);
    expect((out[0]?.payload as ReturnType<typeof automationRow>['payload']).run.status).toBe('succeeded');
  });

  it('filters automation when selected agent does not match', () => {
    const out = selectChatTimelineOrdered.projector([], [automationRow('other', 500)], 'a1', 'c1', {}, sessionsMap);

    expect(out).toHaveLength(0);
  });

  it('shows automation cards on the primary chat session only', () => {
    const automations = [automationRow('a1', 500)];

    const onPrimary = selectChatTimelineOrdered.projector(
      [],
      automations,
      'a1',
      'c1',
      { 'c1:a1': primarySession.id },
      sessionsMap,
    );
    const onUser = selectChatTimelineOrdered.projector(
      [],
      automations,
      'a1',
      'c1',
      { 'c1:a1': userSession.id },
      sessionsMap,
    );

    expect(onPrimary).toHaveLength(1);
    expect(onUser).toHaveLength(0);
  });

  it('filters chat messages by selected chatId when present', () => {
    const out = selectChatTimelineOrdered.projector(
      [chatMessageRow('keep', 1000, 'chat-a', 'm1'), chatMessageRow('drop', 2000, 'chat-b', 'm2')],
      [],
      'a1',
      'c1',
      { 'c1:a1': 'chat-a' },
      sessionsMap,
    );

    expect(out).toHaveLength(1);
    expect((out[0]?.payload as ForwardedEventPayload & { data: { text: string } }).data).toMatchObject({
      text: 'keep',
    });
  });

  it('hides chat messages without chatId when a session is selected', () => {
    const out = selectChatTimelineOrdered.projector(
      [chatMessageRow('legacy', 1000, undefined, 'm1')],
      [],
      'a1',
      'c1',
      { 'c1:a1': 'chat-a' },
      sessionsMap,
    );

    expect(out).toHaveLength(0);
  });
});
