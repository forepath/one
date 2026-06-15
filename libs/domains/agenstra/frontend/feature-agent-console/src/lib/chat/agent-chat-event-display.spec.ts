import type { AgentEventEnvelope, SuccessResponse } from '@forepath/agenstra/frontend/data-access-agent-console';

import {
  consolidateConsecutiveInteractionQueryTimelineRows,
  consolidateConsecutiveThinkingTimelineRows,
  mapForwardedChatEventToDisplayRow,
  mapForwardedChatEventsToDisplayRows,
} from './agent-chat-event-display';

function successEnvelope(data: AgentEventEnvelope): SuccessResponse<AgentEventEnvelope> {
  return {
    success: true,
    data,
    timestamp: new Date().toISOString(),
  };
}

describe('agent-chat-event-display', () => {
  it('maps toolCall with object args to readable summary', () => {
    const row = mapForwardedChatEventToDisplayRow({
      payload: successEnvelope({
        eventId: 'ev-1',
        agentId: 'a1',
        correlationId: 'c1',
        sequence: 1,
        timestamp: '2026-04-08T12:00:00.000Z',
        kind: 'toolCall',
        payload: {
          toolCallId: 't1',
          name: 'read',
          status: 'started',
          args: { path: '/app/README.md', offset: 0 },
        },
      }),
      timestamp: 1000,
    });

    expect(row).not.toBeNull();

    if (row === null) {
      throw new Error('expected row');
    }

    expect(row.summaryTitle).toContain('read');
    expect(row.summaryBody).toContain('started');
    expect(row.summaryBody).toContain('t1');
    expect(row.summaryBody).toContain('README');
    expect(row.detailJson).toContain('"kind": "toolCall"');
    expect(row.detailJson).toContain('"path": "/app/README.md"');
  });

  it('maps toolResult with object result to readable summary (not [object Object])', () => {
    const row = mapForwardedChatEventToDisplayRow({
      payload: successEnvelope({
        eventId: 'ev-2',
        agentId: 'a1',
        correlationId: 'c1',
        sequence: 2,
        timestamp: '2026-04-08T12:00:01.000Z',
        kind: 'toolResult',
        payload: {
          toolCallId: 't1',
          name: 'bash',
          isError: false,
          result: { output: 'hello\n', exit: 0, metadata: { foo: 'bar' } },
        },
      }),
      timestamp: 1001,
    });

    expect(row).not.toBeNull();

    if (row === null) {
      throw new Error('expected row');
    }

    expect(row.summaryBody).toContain('Success');
    expect(row.summaryBody).toContain('hello');
    expect(row.summaryBody).not.toBe('[object Object]');
    expect(row.badgeClass).toBe('text-bg-success');
  });

  it('returns null for non-success payloads', () => {
    expect(
      mapForwardedChatEventToDisplayRow({
        payload: { success: false, error: { message: 'x' }, timestamp: '' },
        timestamp: 1,
      }),
    ).toBeNull();
  });

  it('consolidateConsecutiveThinkingTimelineRows merges adjacent thinking rows', () => {
    const merged = consolidateConsecutiveThinkingTimelineRows([
      {
        trackId: 'a',
        kind: 'thinking',
        kindLabel: 'Thinking',
        summaryTitle: 'Thinking',
        summaryBody: 'First chunk',
        badgeClass: 'bg-light',
        detailJson: '{"a":1}',
        popoverPlainDetail: 'First chunk full',
        displayTimestampMs: 1,
      },
      {
        trackId: 'b',
        kind: 'thinking',
        kindLabel: 'Thinking',
        summaryTitle: 'Thinking',
        summaryBody: ' second chunk',
        badgeClass: 'bg-light',
        detailJson: '{"b":2}',
        popoverPlainDetail: 'Second chunk full',
        displayTimestampMs: 2,
      },
      {
        trackId: 'c',
        kind: 'toolCall',
        kindLabel: 'Tool',
        summaryTitle: 'Tool · read',
        summaryBody: 'started',
        badgeClass: 'text-bg-info',
        detailJson: '{}',
        displayTimestampMs: 3,
      },
    ]);

    expect(merged).toHaveLength(2);
    expect(merged[0]?.kind).toBe('thinking');
    expect(merged[0]?.summaryBody).toContain('First chunk');
    expect(merged[0]?.summaryBody).toContain('second chunk');
    expect(merged[0]?.detailJson).toContain('---');
    expect(merged[0]?.popoverPlainDetail).toBe('First chunk full\nSecond chunk full');
    expect(merged[1]?.kind).toBe('toolCall');
  });

  it('consolidateConsecutiveInteractionQueryTimelineRows merges adjacent interactionQuery rows', () => {
    const merged = consolidateConsecutiveInteractionQueryTimelineRows([
      {
        trackId: 'a',
        kind: 'interactionQuery',
        kindLabel: 'Interaction',
        summaryTitle: 'Query',
        summaryBody: 'First',
        badgeClass: 'bg-light',
        detailJson: '{"a":1}',
        popoverPlainDetail: 'First full',
        displayTimestampMs: 1,
      },
      {
        trackId: 'b',
        kind: 'interactionQuery',
        kindLabel: 'Interaction',
        summaryTitle: 'Query',
        summaryBody: 'Second',
        badgeClass: 'bg-light',
        detailJson: '{"b":2}',
        popoverPlainDetail: 'Second full',
        displayTimestampMs: 2,
      },
      {
        trackId: 'c',
        kind: 'toolCall',
        kindLabel: 'Tool',
        summaryTitle: 'Tool · read',
        summaryBody: 'started',
        badgeClass: 'text-bg-info',
        detailJson: '{}',
        displayTimestampMs: 3,
      },
    ]);

    expect(merged).toHaveLength(2);
    expect(merged[0]?.kind).toBe('interactionQuery');
    expect(merged[0]?.summaryBody).toContain('First');
    expect(merged[0]?.summaryBody).toContain('Second');
    expect(merged[0]?.popoverPlainDetail).toBe('First full\nSecond full');
    expect(merged[1]?.kind).toBe('toolCall');
  });

  it('maps thinking chatEvent to popoverPlainDetail with full phase text', () => {
    const row = mapForwardedChatEventToDisplayRow({
      payload: successEnvelope({
        eventId: 'ev-th',
        agentId: 'a1',
        correlationId: 'c1',
        sequence: 1,
        timestamp: '2026-04-08T12:00:00.000Z',
        kind: 'thinking',
        payload: { phase: 'Planning the refactor across modules' },
      }),
      timestamp: 1000,
    });

    expect(row).not.toBeNull();

    if (row === null) {
      throw new Error('expected row');
    }

    expect(row.popoverPlainDetail).toBe('Planning the refactor across modules');
    expect(row.detailJson).toContain('"kind": "thinking"');
  });

  it('maps interactionQuery chatEvent to popoverPlainDetail with full query text', () => {
    const row = mapForwardedChatEventToDisplayRow({
      payload: successEnvelope({
        eventId: 'ev-iq',
        agentId: 'a1',
        correlationId: 'c1',
        sequence: 1,
        timestamp: '2026-04-08T12:00:00.000Z',
        kind: 'interactionQuery',
        payload: { type: 'interaction_query', query: 'Which files should I edit?' },
      }),
      timestamp: 1000,
    });

    expect(row).not.toBeNull();

    if (row === null) {
      throw new Error('expected row');
    }

    expect(row.popoverPlainDetail).toBe('Which files should I edit?');
    expect(row.detailJson).toContain('"kind": "interactionQuery"');
  });

  it('mapForwardedChatEventsToDisplayRows merges consecutive toolCall and toolResult with same id', () => {
    const rows = mapForwardedChatEventsToDisplayRows([
      {
        payload: successEnvelope({
          eventId: 'tc',
          agentId: 'a',
          correlationId: 'c',
          sequence: 0,
          timestamp: '2026-04-08T12:00:00.000Z',
          kind: 'toolCall',
          payload: { toolCallId: 't1', name: 'read', status: 'started', args: {} },
        }),
        timestamp: 10,
      },
      {
        payload: successEnvelope({
          eventId: 'tr',
          agentId: 'a',
          correlationId: 'c',
          sequence: 1,
          timestamp: '2026-04-08T12:00:01.000Z',
          kind: 'toolResult',
          payload: { toolCallId: 't1', name: 'read', isError: false, result: 'done' },
        }),
        timestamp: 11,
      },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe('toolCall');
    expect(rows[0]?.badgeClass).toBe('text-bg-success');
    expect(rows[0]?.toolPair?.callDetailJson).toBeDefined();
    expect(rows[0]?.toolPair?.resultDetailJson).toBeDefined();
  });

  it('merges toolCall and toolResult with same id when not adjacent in event list', () => {
    const rows = mapForwardedChatEventsToDisplayRows([
      {
        payload: successEnvelope({
          eventId: 'tc',
          agentId: 'a',
          correlationId: 'c',
          sequence: 0,
          timestamp: '2026-04-08T12:00:00.000Z',
          kind: 'toolCall',
          payload: { toolCallId: 't1', name: 'read', status: 'started', args: {} },
        }),
        timestamp: 10,
      },
      {
        payload: successEnvelope({
          eventId: 'st',
          agentId: 'a',
          correlationId: 'c',
          sequence: 1,
          timestamp: '2026-04-08T12:00:00.500Z',
          kind: 'status',
          payload: { message: 'busy' },
        }),
        timestamp: 11,
      },
      {
        payload: successEnvelope({
          eventId: 'tr',
          agentId: 'a',
          correlationId: 'c',
          sequence: 2,
          timestamp: '2026-04-08T12:00:01.000Z',
          kind: 'toolResult',
          payload: { toolCallId: 't1', name: 'read', isError: false, result: 'done' },
        }),
        timestamp: 12,
      },
    ]);

    expect(rows.filter((r) => r.kind === 'toolCall' && r.toolPair?.resultDetailJson)).toHaveLength(1);
    expect(rows.map((r) => r.kind)).toEqual(['toolCall', 'status']);
  });

  it('merges toolResult before toolCall when toolCallId matches', () => {
    const rows = mapForwardedChatEventsToDisplayRows([
      {
        payload: successEnvelope({
          eventId: 'tr',
          agentId: 'a',
          correlationId: 'c',
          sequence: 0,
          timestamp: '2026-04-08T12:00:01.000Z',
          kind: 'toolResult',
          payload: { toolCallId: 't1', name: 'read', isError: false, result: 'first' },
        }),
        timestamp: 11,
      },
      {
        payload: successEnvelope({
          eventId: 'tc',
          agentId: 'a',
          correlationId: 'c',
          sequence: 1,
          timestamp: '2026-04-08T12:00:00.000Z',
          kind: 'toolCall',
          payload: { toolCallId: 't1', name: 'read', status: 'started', args: {} },
        }),
        timestamp: 10,
      },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe('toolCall');
    expect(rows[0]?.toolPair?.resultDetailJson).toBeDefined();
  });

  it('mapForwardedChatEventsToDisplayRows preserves order and filters invalid', () => {
    const rows = mapForwardedChatEventsToDisplayRows([
      {
        payload: successEnvelope({
          eventId: 'e1',
          agentId: 'a',
          correlationId: 'c',
          sequence: 0,
          timestamp: '2026-04-08T12:00:00.000Z',
          kind: 'status',
          payload: { message: 'Working…' },
        }),
        timestamp: 10,
      },
      {
        payload: { success: false, error: { message: 'bad' }, timestamp: '' },
        timestamp: 11,
      },
    ]);

    expect(rows.length).toBe(1);
    expect(rows[0].kind).toBe('status');
  });
});
