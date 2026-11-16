import {
  AgentToolActivityTracker,
  applyToolEvent,
  collectToolActivity,
  summarizeToolActivity,
  TOOL_ACTIVITY_MAX_CHARS,
  truncateToolText,
} from './agent-tool-activity.utils';
import { buildMcpCallItem } from './openai-compatible-response.utils';

describe('agent tool activity', () => {
  it('pairs tool calls and results of a final agent response in call order', () => {
    expect(
      collectToolActivity({
        type: 'agenstra_turn',
        parts: [
          { type: 'tool_call', toolCallId: 'a', name: 'bash', args: { command: 'ls' }, status: 'succeeded' },
          { type: 'tool_result', toolCallId: 'a', name: 'bash', result: { stdout: 'x' }, isError: false },
          { type: 'result', result: 'intermediate' },
          { type: 'tool_call', toolCallId: 'b', name: 'read', args: { path: 'a' }, status: 'pending' },
          { type: 'tool_result', toolCallId: 'b', name: 'read', result: 'nope', isError: true },
          { type: 'tool_call', toolCallId: 'c', name: 'edit', args: {}, status: 'pending' },
          { type: 'tool_result', toolCallId: 'd', name: 'grep', result: 'hit', isError: false, args: { q: 'x' } },
          { type: 'tool_call', toolCallId: 'e', name: 'enrichment', args: {} },
          { type: 'result', result: 'final' },
        ],
      }),
    ).toEqual([
      { id: 'a', name: 'bash', arguments: '{"command":"ls"}', output: '{"stdout":"x"}', status: 'completed' },
      { id: 'b', name: 'read', arguments: '{"path":"a"}', output: 'nope', status: 'failed' },
      { id: 'c', name: 'edit', arguments: '', output: null, status: 'in_progress' },
      { id: 'd', name: 'grep', arguments: '{"q":"x"}', output: 'hit', status: 'completed' },
    ]);
  });

  it('returns nothing for responses without tool parts', () => {
    expect(collectToolActivity({ type: 'result', result: 'x' })).toEqual([]);
    expect(collectToolActivity('plain')).toEqual([]);
    expect(collectToolActivity(undefined)).toEqual([]);
  });

  it('tracks live events and reports new calls and completions once', () => {
    const tracker = new AgentToolActivityTracker();

    expect(
      applyToolEvent(tracker, { kind: 'toolCall', payload: { toolCallId: 't', name: 'bash', args: { c: 1 } } }),
    ).toEqual(expect.objectContaining({ id: 't', status: 'in_progress' }));
    expect(
      applyToolEvent(tracker, { kind: 'toolCall', payload: { toolCallId: 't', name: 'bash', status: 'inProgress' } }),
    ).toBeUndefined();
    expect(
      applyToolEvent(tracker, { kind: 'toolResult', payload: { toolCallId: 't', name: 'bash', result: 'ok' } }),
    ).toEqual(expect.objectContaining({ id: 't', output: 'ok', status: 'completed' }));
    expect(applyToolEvent(tracker, { kind: 'toolCall', payload: { name: 'no-id' } })).toBeUndefined();
    expect(tracker.list()).toHaveLength(1);
  });

  it('truncates large arguments and outputs', () => {
    const big = 'x'.repeat(TOOL_ACTIVITY_MAX_CHARS + 50);
    const [activity] = collectToolActivity({
      type: 'agenstra_turn',
      parts: [
        { type: 'tool_call', toolCallId: 'a', name: 'read', args: { path: big } },
        { type: 'tool_result', toolCallId: 'a', name: 'read', result: big },
      ],
    });

    expect(activity.output?.length).toBeLessThan(TOOL_ACTIVITY_MAX_CHARS + 60);
    expect(activity.output).toContain('[truncated 50 characters]');
    expect(activity.arguments).toContain('[truncated');
    expect(truncateToolText('short')).toBe('short');
  });

  it('renders summaries and OpenAI mcp_call items', () => {
    const activity = {
      id: 'call:1/x',
      name: 'bash',
      arguments: '{"command":"ls"}',
      output: 'a',
      status: 'completed' as const,
    };

    expect(summarizeToolActivity(activity)).toBe('[agent tool] bash {"command":"ls"} → done');
    expect(summarizeToolActivity({ ...activity, status: 'failed' })).toContain('→ failed');
    expect(buildMcpCallItem(activity)).toEqual({
      type: 'mcp_call',
      id: 'mcp_call1x',
      server_label: 'agenstra',
      name: 'bash',
      arguments: '{"command":"ls"}',
      output: 'a',
      error: null,
      status: 'completed',
    });
    expect(buildMcpCallItem({ ...activity, status: 'failed', output: 'boom' })).toEqual(
      expect.objectContaining({ status: 'failed', error: 'boom' }),
    );
    expect(buildMcpCallItem({ ...activity, arguments: '', status: 'in_progress', output: null })).toEqual(
      expect.objectContaining({ arguments: '{}', status: 'in_progress', output: null, error: null }),
    );
  });

  it('takes the arguments from the result when the call reported none', () => {
    const tracker = new AgentToolActivityTracker();

    applyToolEvent(tracker, { kind: 'toolCall', payload: { toolCallId: 't', name: 'bash', args: {} } });
    const done = applyToolEvent(tracker, {
      kind: 'toolResult',
      payload: { toolCallId: 't', name: 'bash', result: 'a.txt', args: { command: 'ls' } },
    });

    expect(done?.arguments).toBe('{"command":"ls"}');
    expect(summarizeToolActivity(done as NonNullable<typeof done>)).toBe('[agent tool] bash {"command":"ls"} → done');
  });
});
