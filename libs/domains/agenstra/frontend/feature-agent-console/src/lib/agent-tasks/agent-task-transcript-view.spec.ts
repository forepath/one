import { buildAgentHandoffResponseMessage } from '@forepath/agenstra/shared/util-opencode-config';

import { buildAgentTaskTranscriptSegments } from './agent-task-transcript-view';

const event = (kind: string, payload: Record<string, unknown>, timestamp: number) => ({
  payload: {
    success: true,
    data: {
      eventId: `e-${timestamp}`,
      agentId: 'a1',
      correlationId: 'c1',
      sequence: timestamp,
      timestamp: new Date(timestamp).toISOString(),
      kind,
      payload,
    },
  },
  timestamp,
});

describe('buildAgentTaskTranscriptSegments', () => {
  it('hides the run prompt, renders the answer and groups the events in between', () => {
    const segments = buildAgentTaskTranscriptSegments([
      event('userMessage', { text: 'Run the report' }, 1),
      event('thinking', { phase: 'running' }, 2),
      event('toolCall', { toolCallId: 't1', name: 'bash', args: { command: 'ls' }, status: 'running' }, 3),
      event('assistantMessage', { text: ' Report done. ' }, 4),
    ]);

    expect(segments.map((segment) => segment.kind)).toEqual(['events', 'assistant']);
    expect(segments[1]).toEqual(expect.objectContaining({ text: 'Report done.', timestamp: 4 }));
    expect(segments[0].kind === 'events' && segments[0].rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(segments)).not.toContain('Run the report');
  });

  it('skips empty messages and unparseable events', () => {
    expect(
      buildAgentTaskTranscriptSegments([
        event('assistantMessage', { text: '   ' }, 1),
        { payload: 'garbage', timestamp: 2 },
      ]),
    ).toEqual([]);
  });

  it('never surfaces raw thinking frames as an answer', () => {
    const segments = buildAgentTaskTranscriptSegments([event('thinking', { phase: 'running' }, 1)]);

    expect(segments.every((segment) => segment.kind === 'events')).toBe(true);
  });

  it('shows handoff responses delivered into the run as cards and keeps the run prompt hidden', () => {
    const response = buildAgentHandoffResponseMessage(
      {
        id: 'h1',
        title: 'Check logs',
        status: 'completed',
        targetAgentId: 'agent-b',
        targetAgentName: 'Reviewer',
        targetChatId: 'chat-b',
      },
      'No errors found.',
      'Continue with the work that depended on it.',
    );
    const segments = buildAgentTaskTranscriptSegments([
      event('userMessage', { text: 'Run the report' }, 1),
      event('assistantMessage', { text: 'Handed off.' }, 2),
      event('userMessage', { text: response }, 3),
      event('assistantMessage', { text: 'Report done.' }, 4),
    ]);

    expect(segments.map((segment) => segment.kind)).toEqual(['assistant', 'handoffResponse', 'assistant']);
    expect(segments[1]).toEqual(
      expect.objectContaining({
        timestamp: 3,
        card: expect.objectContaining({
          kind: 'response',
          agentName: 'Reviewer',
          status: 'completed',
          body: 'No errors found.',
          link: { agentId: 'agent-b', chatId: 'chat-b' },
        }),
      }),
    );
    expect(JSON.stringify(segments)).not.toContain('Continue with the work');
  });
});
