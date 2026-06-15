import { accumulateStreamingTurnFromEvents } from './agent-chat-streaming-aggregate';

function env(kind: string, payload: unknown, eventId = 'e1') {
  return {
    success: true as const,
    data: {
      eventId,
      agentId: 'a1',
      correlationId: 'c1',
      sequence: 1,
      timestamp: new Date().toISOString(),
      kind,
      payload,
    },
  };
}

describe('accumulateStreamingTurnFromEvents', () => {
  it('ignores events at or before the stream baseline timestamp', () => {
    const baseline = 1000;
    const result = accumulateStreamingTurnFromEvents(
      [
        { payload: env('assistantDelta', { delta: 'a' }), timestamp: 999 },
        { payload: env('assistantDelta', { delta: 'b' }), timestamp: 1000 },
        { payload: env('assistantDelta', { delta: 'c' }, 'e2'), timestamp: 1001 },
      ],
      baseline,
    );

    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]?.kind).toBe('markdown');

    if (result.segments[0]?.kind === 'markdown') {
      expect(result.segments[0].markdown).toBe('c');
    }
  });

  it('concatenates assistantDelta and replaces on assistantMessage', () => {
    const result = accumulateStreamingTurnFromEvents(
      [
        { payload: env('assistantDelta', { delta: 'Hel' }, '1'), timestamp: 10 },
        { payload: env('assistantDelta', { delta: 'lo' }, '2'), timestamp: 11 },
        { payload: env('assistantMessage', { text: 'Hello world' }, '3'), timestamp: 12 },
      ],
      0,
    );

    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]?.kind).toBe('markdown');

    if (result.segments[0]?.kind === 'markdown') {
      expect(result.segments[0].markdown).toBe('Hello world');
    }
  });

  it('adds tool and status rows in event order', () => {
    const result = accumulateStreamingTurnFromEvents(
      [
        { payload: env('status', { message: 'Working' }, 's1'), timestamp: 5 },
        { payload: env('toolCall', { name: 'read', toolCallId: 't1', status: 'pending' }, 't1'), timestamp: 6 },
      ],
      0,
    );

    expect(result.segments).toHaveLength(2);
    expect(result.segments[0]?.kind).toBe('row');
    expect(result.segments[1]?.kind).toBe('row');

    if (result.segments[0]?.kind === 'row' && result.segments[1]?.kind === 'row') {
      expect(result.segments[0].row.kind).toBe('status');
      expect(result.segments[1].row.kind).toBe('toolCall');
    }
  });

  it('interleaves assistant text between structured rows', () => {
    const result = accumulateStreamingTurnFromEvents(
      [
        { payload: env('toolCall', { name: 'read', toolCallId: 't1', status: 'pending' }, 't1'), timestamp: 1 },
        { payload: env('assistantDelta', { delta: 'Between' }, 'd1'), timestamp: 2 },
        { payload: env('toolResult', { toolCallId: 't1', result: 'ok' }, 'r1'), timestamp: 3 },
      ],
      0,
    );

    expect(result.segments.map((s) => s.kind)).toEqual(['row', 'markdown']);
  });

  it('merges toolCall and toolResult with matching id when result arrives before call', () => {
    const result = accumulateStreamingTurnFromEvents(
      [
        {
          payload: env('toolResult', { toolCallId: 't1', name: 'read', isError: false, result: 'early' }, 'r1'),
          timestamp: 1,
        },
        { payload: env('toolCall', { name: 'read', toolCallId: 't1', status: 'pending' }, 't1'), timestamp: 2 },
      ],
      0,
    );

    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]?.kind).toBe('row');

    if (result.segments[0]?.kind === 'row') {
      expect(result.segments[0].row.kind).toBe('toolCall');
      expect(result.segments[0].row.toolPair?.callDetailJson).toBeDefined();
      expect(result.segments[0].row.toolPair?.resultDetailJson).toBeDefined();
    }
  });

  it('merges consecutive toolCall and toolResult when toolCallId matches', () => {
    const result = accumulateStreamingTurnFromEvents(
      [
        { payload: env('toolCall', { name: 'read', toolCallId: 't1', status: 'pending' }, 't1'), timestamp: 1 },
        {
          payload: env('toolResult', { toolCallId: 't1', name: 'read', isError: false, result: 'ok' }, 'r1'),
          timestamp: 2,
        },
      ],
      0,
    );

    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]?.kind).toBe('row');

    if (result.segments[0]?.kind === 'row') {
      expect(result.segments[0].row.kind).toBe('toolCall');
      expect(result.segments[0].row.toolPair?.resultDetailJson).toContain('toolResult');
    }
  });

  it('adds thinking row to timeline before assistant output', () => {
    const result = accumulateStreamingTurnFromEvents(
      [
        { payload: env('thinking', {}, 'th1'), timestamp: 2 },
        { payload: env('assistantDelta', { delta: 'Hi' }, 'd1'), timestamp: 3 },
      ],
      0,
    );

    expect(result.segments[0]?.kind).toBe('row');

    if (result.segments[0]?.kind === 'row') {
      expect(result.segments[0].row.kind).toBe('thinking');
    }

    expect(result.segments[1]?.kind).toBe('markdown');

    if (result.segments[1]?.kind === 'markdown') {
      expect(result.segments[1].markdown).toBe('Hi');
    }
  });

  it('consolidates consecutive thinking events into one timeline row', () => {
    const result = accumulateStreamingTurnFromEvents(
      [
        { payload: env('thinking', { phase: 'Part A' }, 'th1'), timestamp: 1 },
        { payload: env('thinking', { phase: 'Part B' }, 'th2'), timestamp: 2 },
        { payload: env('assistantDelta', { delta: 'x' }, 'd1'), timestamp: 3 },
      ],
      0,
    );
    const thinking = result.segments.filter((s) => s.kind === 'row' && s.row.kind === 'thinking');

    expect(thinking).toHaveLength(1);
    const first = thinking[0];

    expect(first?.kind).toBe('row');

    if (first?.kind === 'row') {
      expect(first.row.summaryBody).toContain('Part A');
      expect(first.row.summaryBody).toContain('Part B');
    }
  });
});
