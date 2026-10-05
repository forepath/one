import type { TicketAutomationRunChatEventPayload } from '@forepath/agenstra/frontend/data-access-agent-console';

import {
  buildAgentTurnView,
  buildChatDisplayThread,
  buildMergedChatDisplayThread,
  type ChatMessageWithFilter,
  type ChatTimelineOrderedRowLike,
} from './chat-thread-display';

function chatMsg(from: 'user' | 'agent', response: unknown, ts: number): ChatMessageWithFilter {
  const iso = new Date(ts).toISOString();

  return {
    event: 'chatMessage',
    timestamp: ts,
    filterResult: null,
    payload: {
      success: true,
      data:
        from === 'user'
          ? { from: 'user', text: String(response), timestamp: iso }
          : { from: 'agent', response, timestamp: iso },
      timestamp: iso,
    } as ChatMessageWithFilter['payload'],
  };
}

describe('buildChatDisplayThread', () => {
  it('groups consecutive agent messages into one agent turn', () => {
    const items = buildChatDisplayThread([
      chatMsg('user', 'hi', 1),
      chatMsg('agent', { type: 'tool_call', toolCallId: 'a', name: 'read', status: 'x' }, 2),
      chatMsg('agent', { type: 'result', result: 'ok' }, 3),
    ]);

    expect(items).toHaveLength(2);
    expect(items[0]?.kind).toBe('user');
    expect(items[1]?.kind).toBe('agentTurn');

    if (items[1]?.kind === 'agentTurn') {
      expect(items[1].msgs).toHaveLength(2);
      const rowCount = items[1].view.segments.filter((s) => s.kind === 'row').length;

      expect(rowCount).toBeGreaterThanOrEqual(1);
    }
  });

  it('hides chat-plan execute trigger user messages', () => {
    const items = buildChatDisplayThread([
      chatMsg(
        'user',
        'Implement the following plan in the repository. Stay scoped to the plan below.\n\n## Plan\nDo it',
        1,
      ),
      chatMsg('agent', { type: 'result', result: 'done' }, 2),
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe('agentTurn');
  });
});

describe('buildAgentTurnView', () => {
  it('expands agenstra_turn composite from a single message', () => {
    const view = buildAgentTurnView([
      chatMsg(
        'agent',
        {
          type: 'agenstra_turn',
          subtype: 'success',
          parts: [{ type: 'tool_result', toolCallId: 't', name: 'bash', result: 'out', isError: false }],
        },
        10,
      ),
    ]);

    expect(view.segments.some((s) => s.kind === 'row' && s.row.kind === 'toolResult')).toBe(true);
  });

  it('maps thinking parts in agenstra_turn to structured timeline rows like Delta/Tool', () => {
    const view = buildAgentTurnView([
      chatMsg(
        'agent',
        {
          type: 'agenstra_turn',
          subtype: 'success',
          parts: [
            { type: 'thinking', text: 'Reasoning about files' },
            { type: 'result', subtype: 'success', result: 'Done.' },
          ],
        },
        10,
      ),
    ]);

    expect(view.segments.some((s) => s.kind === 'row' && s.row.kind === 'thinking')).toBe(true);
    const md = view.segments.find((s) => s.kind === 'markdown');

    expect(md?.kind).toBe('markdown');

    if (md?.kind === 'markdown') {
      expect(md.markdown).toBe('Done.');
    }
  });

  it('maps interaction_query parts in agenstra_turn to structured timeline rows', () => {
    const view = buildAgentTurnView([
      chatMsg(
        'agent',
        {
          type: 'agenstra_turn',
          subtype: 'success',
          parts: [
            { type: 'interaction_query', query: 'Confirm scope?' },
            { type: 'result', subtype: 'success', result: 'Done.' },
          ],
        },
        10,
      ),
    ]);

    expect(view.segments.some((s) => s.kind === 'row' && s.row.kind === 'interactionQuery')).toBe(true);
  });

  it('consolidates consecutive thinking parts in agenstra_turn into one row', () => {
    const view = buildAgentTurnView([
      chatMsg(
        'agent',
        {
          type: 'agenstra_turn',
          subtype: 'success',
          parts: [
            { type: 'thinking', text: 'Chunk one' },
            { type: 'thinking', text: 'Chunk two' },
            { type: 'result', subtype: 'success', result: 'OK' },
          ],
        },
        10,
      ),
    ]);
    const thinkingRows = view.segments.filter((s) => s.kind === 'row' && s.row.kind === 'thinking');

    expect(thinkingRows).toHaveLength(1);
    const first = thinkingRows[0];

    expect(first?.kind).toBe('row');

    if (first?.kind === 'row') {
      expect(first.row.summaryBody).toContain('Chunk one');
      expect(first.row.summaryBody).toContain('Chunk two');
    }
  });

  it('consolidates consecutive interaction_query parts in agenstra_turn into one row', () => {
    const view = buildAgentTurnView([
      chatMsg(
        'agent',
        {
          type: 'agenstra_turn',
          subtype: 'success',
          parts: [
            { type: 'interaction_query', query: 'Part one' },
            { type: 'interaction_query', prompt: 'Part two' },
            { type: 'result', subtype: 'success', result: 'OK' },
          ],
        },
        10,
      ),
    ]);
    const rows = view.segments.filter((s) => s.kind === 'row' && s.row.kind === 'interactionQuery');

    expect(rows).toHaveLength(1);
    const first = rows[0];

    expect(first?.kind).toBe('row');

    if (first?.kind === 'row') {
      expect(first.row.summaryBody).toContain('Part one');
      expect(first.row.summaryBody).toContain('Part two');
    }
  });

  it('preserves interleaved structured rows and prose in agenstra_turn part order', () => {
    const view = buildAgentTurnView([
      chatMsg(
        'agent',
        {
          type: 'agenstra_turn',
          subtype: 'success',
          parts: [
            { type: 'tool_call', toolCallId: 't1', name: 'read', status: 'pending' },
            { type: 'tool_result', toolCallId: 't1', name: 'read', result: 'pre', isError: false },
            { type: 'result', subtype: 'success', result: 'Middle reply' },
            { type: 'tool_result', toolCallId: 't2', name: 'bash', result: 'exit 0', isError: false },
          ],
        },
        10,
      ),
    ]);

    expect(view.segments.map((s) => s.kind)).toEqual(['row', 'markdown', 'row']);
    const mid = view.segments[1];

    expect(mid?.kind).toBe('markdown');

    if (mid?.kind === 'markdown') {
      expect(mid.markdown).toContain('Middle reply');
    }
  });

  it('merges adjacent tool_call and matching tool_result in agenstra_turn', () => {
    const view = buildAgentTurnView([
      chatMsg(
        'agent',
        {
          type: 'agenstra_turn',
          subtype: 'success',
          parts: [
            { type: 'tool_call', toolCallId: 't1', name: 'read', status: 'pending' },
            { type: 'tool_result', toolCallId: 't1', name: 'read', result: 'file', isError: false },
          ],
        },
        10,
      ),
    ]);

    expect(view.segments.filter((s) => s.kind === 'row')).toHaveLength(1);
    const first = view.segments[0];

    expect(first?.kind).toBe('row');

    if (first?.kind === 'row') {
      expect(first.row.kind).toBe('toolCall');
      expect(first.row.toolPair?.callDetailJson).toBeDefined();
      expect(first.row.toolPair?.resultDetailJson).toBeDefined();
    }
  });

  it('merges tool_result before tool_call in agenstra_turn when toolCallId matches', () => {
    const view = buildAgentTurnView([
      chatMsg(
        'agent',
        {
          type: 'agenstra_turn',
          subtype: 'success',
          parts: [
            { type: 'tool_result', toolCallId: 't1', name: 'read', result: 'first', isError: false },
            { type: 'tool_call', toolCallId: 't1', name: 'read', status: 'pending' },
          ],
        },
        10,
      ),
    ]);

    expect(view.segments.filter((s) => s.kind === 'row')).toHaveLength(1);
    const first = view.segments[0];

    expect(first?.kind).toBe('row');

    if (first?.kind === 'row') {
      expect(first.row.toolPair?.callDetailJson).toBeDefined();
      expect(first.row.toolPair?.resultDetailJson).toBeDefined();
    }
  });
  it('omits step status/thinking and maps other status to structured rows', () => {
    const view = buildAgentTurnView([
      chatMsg(
        'agent',
        {
          type: 'agenstra_turn',
          parts: [
            { type: 'thinking', phase: 'step' },
            { type: 'status', subtype: 'step', title: 'Step', message: 'Step finished (stop)' },
            { type: 'status', subtype: 'todo', title: 'Todos', message: '1. ship' },
            { type: 'result', result: '<hidden-context>\nx\n</hidden-context>\nDone' },
          ],
        },
        10,
      ),
    ]);

    const kinds = view.segments.map((s) => (s.kind === 'row' ? s.row.kind : 'markdown'));

    expect(kinds).toContain('status');
    expect(kinds).not.toContain('thinking');
    expect(view.segments.some((s) => s.kind === 'row' && s.row.summaryTitle === 'Step')).toBe(false);
    expect(view.segments.some((s) => s.kind === 'row' && s.row.summaryTitle === 'Todos')).toBe(true);
    const md = view.segments.find((s) => s.kind === 'markdown');

    expect(md?.kind === 'markdown' ? md.markdown : '').toContain('Done');
    expect(md?.kind === 'markdown' ? md.markdown : '').not.toContain('hidden-context');
  });

  it('omits question tool_call/tool_result parts without falling back to markdown', () => {
    const view = buildAgentTurnView([
      chatMsg(
        'agent',
        {
          type: 'agenstra_turn',
          parts: [
            {
              type: 'tool_call',
              toolCallId: 'call_q',
              name: 'question',
              status: 'pending',
              args: {},
            },
            {
              type: 'question',
              subtype: 'question',
              questionId: 'q_1',
              prompt: 'Pick a color',
              options: [{ id: 'red', label: 'Red' }],
            },
            {
              type: 'tool_result',
              toolCallId: 'call_q',
              name: 'question',
              result: 'Red',
              isError: false,
            },
            { type: 'result', result: 'Done' },
          ],
        },
        10,
      ),
    ]);

    const markdown = view.segments
      .filter((s): s is Extract<(typeof view.segments)[number], { kind: 'markdown' }> => s.kind === 'markdown')
      .map((s) => s.markdown)
      .join('\n');

    expect(markdown).not.toContain('Tool call');
    expect(markdown).not.toContain('question');
    expect(markdown).toContain('Done');
    expect(view.segments.some((s) => s.kind === 'row' && s.row.kind === 'question')).toBe(true);
    expect(view.segments.some((s) => s.kind === 'row' && s.row.toolName === 'question')).toBe(false);
  });
});

function autoPayload(
  ticketId: string,
  runId: string,
  agentId: string,
  timelineAt: string,
): TicketAutomationRunChatEventPayload {
  return {
    timelineAt,
    hydrate: false,
    ticket: {
      id: ticketId,
      clientId: 'c1',
      title: 'T',
      priority: 'medium',
      status: 'todo',
      automationEligible: true,
      preferredChatAgentId: null,
      createdAt: timelineAt,
      updatedAt: timelineAt,
    },
    run: {
      id: runId,
      ticketId,
      clientId: 'c1',
      agentId,
      status: 'running',
      phase: 'iterate',
      startedAt: timelineAt,
      updatedAt: timelineAt,
      finishedAt: null,
    },
    actions: [{ type: 'openTicketAutomationRun', ticketId, runId, label: 'Open' }],
  };
}

describe('buildMergedChatDisplayThread', () => {
  it('interleaves automation between user and agent by semantic order', () => {
    const u = chatMsg('user', 'hi', 1);
    const a = chatMsg('agent', { type: 'result', result: 'ok' }, 4);
    const p = autoPayload('tid', 'rid', 'aid', new Date(2).toISOString());
    const ordered: ChatTimelineOrderedRowLike[] = [
      { ...u, semanticTimestamp: 1 },
      {
        event: 'ticketAutomationRunChatUpsert',
        payload: p,
        timestamp: 2,
        semanticTimestamp: 2,
      },
      { ...a, semanticTimestamp: 4 },
    ];
    const thread = buildMergedChatDisplayThread(ordered, [u, a]);

    expect(thread.map((i) => i.kind)).toEqual(['user', 'ticketAutomationRun', 'agentTurn']);
  });

  it('dedupes automation by run id is done upstream; single automation row is preserved', () => {
    const u = chatMsg('user', 'x', 10);
    const p = autoPayload('tid', 'rid', 'aid', new Date(11).toISOString());
    const ordered: ChatTimelineOrderedRowLike[] = [
      { ...u, semanticTimestamp: 10 },
      {
        event: 'ticketAutomationRunChatUpsert',
        payload: p,
        timestamp: 11,
        semanticTimestamp: 11,
      },
    ];
    const thread = buildMergedChatDisplayThread(ordered, [u]);

    expect(thread[1]?.kind).toBe('ticketAutomationRun');
  });

  it('interleaves chatPlan cards between user and agent by semantic order', () => {
    const u = chatMsg('user', 'hi', 1);
    const a = chatMsg('agent', { type: 'result', result: 'ok' }, 4);
    const planPayload = {
      timelineAt: new Date(2).toISOString(),
      hydrate: false,
      plan: {
        id: 'p1',
        clientId: 'c1',
        agentId: 'aid',
        chatId: 'chat-1',
        status: 'ready' as const,
        phase: 'ready' as const,
        sourcePrompt: 'plan',
        planMarkdown: '# Plan',
        summary: 'Do the thing',
        contextInjection: null,
        model: null,
        resumeSessionSuffix: '-plan-p1',
        completionSignalSeen: false,
        failureCode: null,
        failureMessage: null,
        createdByUserId: null,
        startedAt: new Date(2).toISOString(),
        finishedAt: null,
        createdAt: new Date(2).toISOString(),
        updatedAt: new Date(2).toISOString(),
      },
      actions: [
        { type: 'openChatPlan' as const, planId: 'p1', chatId: 'chat-1', label: 'View plan' },
        { type: 'executeChatPlan' as const, planId: 'p1', chatId: 'chat-1', label: 'Execute plan' },
      ],
    };
    const ordered: ChatTimelineOrderedRowLike[] = [
      { ...u, semanticTimestamp: 1 },
      {
        event: 'chatPlanUpsert',
        payload: planPayload,
        timestamp: 2,
        semanticTimestamp: 2,
      },
      { ...a, semanticTimestamp: 4 },
    ];
    const thread = buildMergedChatDisplayThread(ordered, [u, a]);

    expect(thread.map((i) => i.kind)).toEqual(['user', 'chatPlan', 'agentTurn']);
    expect(thread[1]?.kind === 'chatPlan' && thread[1].payload.plan.summary).toBe('Do the thing');
  });
});
