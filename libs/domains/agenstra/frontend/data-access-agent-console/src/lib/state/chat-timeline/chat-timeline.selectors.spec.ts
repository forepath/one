import { CLIENT_CHAT_AUTOMATION_SOCKET_EVENT } from '../container-socket/client-chat-automation.constants';
import { CLIENT_CHAT_PLAN_SOCKET_EVENT } from '../container-socket/client-chat-plan.constants';
import {
  ChatActor,
  type ChatPlanChatEventPayload,
  type ForwardedEventPayload,
} from '../container-socket/container-socket.types';

import { selectChatPlanBusyForSelectedChat, selectChatTimelineOrdered } from './chat-timeline.selectors';
import type { ChatTimelineAutomationRow, ChatTimelineMessageRow, ChatTimelinePlanRow } from './chat-timeline.types';

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

function planRow(
  agentId: string,
  chatId: string,
  timelineAtMs: number,
  status: ChatPlanChatEventPayload['plan']['status'] = 'exploring',
  planId = 'p1',
): ChatTimelinePlanRow {
  const iso = new Date(timelineAtMs).toISOString();

  return {
    event: CLIENT_CHAT_PLAN_SOCKET_EVENT,
    timestamp: timelineAtMs,
    payload: {
      timelineAt: iso,
      hydrate: false,
      plan: {
        id: planId,
        clientId: 'c1',
        agentId,
        chatId,
        status,
        phase: status === 'ready' ? 'ready' : 'explore',
        sourcePrompt: 'plan this',
        planMarkdown: status === 'ready' ? '# Plan' : null,
        summary: 'Summary',
        contextInjection: null,
        model: null,
        resumeSessionSuffix: `-plan-${planId}`,
        completionSignalSeen: false,
        failureCode: null,
        failureMessage: null,
        createdByUserId: null,
        startedAt: iso,
        finishedAt: null,
        createdAt: iso,
        updatedAt: iso,
      },
      actions: [{ type: 'openChatPlan', planId, chatId, label: 'View plan' }],
    },
  };
}

describe('selectChatTimelineOrdered', () => {
  it('orders chat and automation by semantic timestamp and dedupes automation by run id', () => {
    const messages = [chatMessageRow('hi', 1000)];
    const automations = [automationRow('a1', 500, 'running'), automationRow('a1', 800, 'succeeded')];
    const out = selectChatTimelineOrdered.projector(
      messages,
      automations,
      [],
      'a1',
      'c1',
      { 'c1:a1': null },
      sessionsMap,
    );

    expect(out.map((r) => r.event)).toEqual([CLIENT_CHAT_AUTOMATION_SOCKET_EVENT, 'chatMessage']);
    expect((out[0]?.payload as ReturnType<typeof automationRow>['payload']).run.status).toBe('succeeded');
  });

  it('filters automation when selected agent does not match', () => {
    const out = selectChatTimelineOrdered.projector([], [automationRow('other', 500)], [], 'a1', 'c1', {}, sessionsMap);

    expect(out).toHaveLength(0);
  });

  it('shows automation cards on the primary chat session only', () => {
    const automations = [automationRow('a1', 500)];

    const onPrimary = selectChatTimelineOrdered.projector(
      [],
      automations,
      [],
      'a1',
      'c1',
      { 'c1:a1': primarySession.id },
      sessionsMap,
    );
    const onUser = selectChatTimelineOrdered.projector(
      [],
      automations,
      [],
      'a1',
      'c1',
      { 'c1:a1': userSession.id },
      sessionsMap,
    );

    expect(onPrimary).toHaveLength(1);
    expect(onUser).toHaveLength(0);
  });

  it('merges chat-scoped plan cards and keeps automation primary-only', () => {
    const plans = [planRow('a1', userSession.id, 700)];
    const automations = [automationRow('a1', 500)];

    const onUser = selectChatTimelineOrdered.projector(
      [chatMessageRow('hi', 1000, userSession.id)],
      automations,
      plans,
      'a1',
      'c1',
      { 'c1:a1': userSession.id },
      sessionsMap,
    );
    const onPrimary = selectChatTimelineOrdered.projector(
      [],
      automations,
      [planRow('a1', primarySession.id, 700)],
      'a1',
      'c1',
      { 'c1:a1': primarySession.id },
      sessionsMap,
    );

    expect(onUser.map((r) => r.event)).toEqual([CLIENT_CHAT_PLAN_SOCKET_EVENT, 'chatMessage']);
    expect(onPrimary.map((r) => r.event)).toEqual([CLIENT_CHAT_AUTOMATION_SOCKET_EVENT, CLIENT_CHAT_PLAN_SOCKET_EVENT]);
  });

  it('filters plans by selected chatId and agent', () => {
    const plans = [
      planRow('a1', 'chat-a', 500, 'ready', 'p-a'),
      planRow('a1', 'chat-b', 600, 'ready', 'p-b'),
      planRow('other', 'chat-a', 700, 'ready', 'p-other'),
    ];
    const out = selectChatTimelineOrdered.projector([], [], plans, 'a1', 'c1', { 'c1:a1': 'chat-a' }, sessionsMap);

    expect(out).toHaveLength(1);
    expect((out[0]?.payload as ChatPlanChatEventPayload).plan.id).toBe('p-a');
  });

  it('dedupes plans by plan id keeping latest timelineAt', () => {
    const plans = [planRow('a1', 'chat-a', 500, 'exploring', 'p1'), planRow('a1', 'chat-a', 800, 'ready', 'p1')];
    const out = selectChatTimelineOrdered.projector([], [], plans, 'a1', 'c1', { 'c1:a1': 'chat-a' }, sessionsMap);

    expect(out).toHaveLength(1);
    expect((out[0]?.payload as ChatPlanChatEventPayload).plan.status).toBe('ready');
  });

  it('filters chat messages by selected chatId when present', () => {
    const out = selectChatTimelineOrdered.projector(
      [chatMessageRow('keep', 1000, 'chat-a', 'm1'), chatMessageRow('drop', 2000, 'chat-b', 'm2')],
      [],
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
      [],
      'a1',
      'c1',
      { 'c1:a1': 'chat-a' },
      sessionsMap,
    );

    expect(out).toHaveLength(0);
  });
});

describe('selectChatPlanBusyForSelectedChat', () => {
  it('is true when selected chat has an exploring plan for the agent', () => {
    const busy = selectChatPlanBusyForSelectedChat.projector([planRow('a1', 'chat-a', 500, 'exploring')], 'a1', 'c1', {
      'c1:a1': 'chat-a',
    });

    expect(busy).toBe(true);
  });

  it('is false for ready plans or other chats', () => {
    expect(
      selectChatPlanBusyForSelectedChat.projector([planRow('a1', 'chat-a', 500, 'ready')], 'a1', 'c1', {
        'c1:a1': 'chat-a',
      }),
    ).toBe(false);
    expect(
      selectChatPlanBusyForSelectedChat.projector([planRow('a1', 'chat-b', 500, 'exploring')], 'a1', 'c1', {
        'c1:a1': 'chat-a',
      }),
    ).toBe(false);
  });
});
