import {
  AGENT_TASK_TRANSCRIPT_MAX_EVENTS,
  AGENT_TASK_TRANSCRIPT_MAX_STRING_LENGTH,
  agentTaskTranscriptEventKind,
  appendAgentTaskTranscriptEvent,
  type AgentTaskTranscriptEvent,
} from './agent-task-transcript.utils';

const envelope = (kind: string, payload: Record<string, unknown> = {}) => ({
  success: true,
  data: { eventId: `e-${kind}`, kind, payload },
});

describe('agent task transcript utils', () => {
  it('reads the kind of wrapped and bare envelopes', () => {
    expect(agentTaskTranscriptEventKind(envelope('toolCall'))).toBe('toolCall');
    expect(agentTaskTranscriptEventKind({ kind: 'thinking' })).toBe('thinking');
    expect(agentTaskTranscriptEventKind('nope')).toBe('');
  });

  it('stores events except streaming deltas and unknown payloads', () => {
    const transcript: AgentTaskTranscriptEvent[] = [];

    expect(appendAgentTaskTranscriptEvent(transcript, envelope('userMessage', { text: 'hi' }), 1)).toBe(true);
    expect(appendAgentTaskTranscriptEvent(transcript, envelope('assistantDelta', { delta: 'he' }), 2)).toBe(false);
    expect(appendAgentTaskTranscriptEvent(transcript, { foo: 1 }, 3)).toBe(false);
    expect(appendAgentTaskTranscriptEvent(transcript, envelope('assistantMessage', { text: 'hello' }), 4)).toBe(true);

    expect(transcript.map((entry) => [agentTaskTranscriptEventKind(entry.payload), entry.timestamp])).toEqual([
      ['userMessage', 1],
      ['assistantMessage', 4],
    ]);
  });

  it('cuts long strings and keeps the newest events', () => {
    const transcript: AgentTaskTranscriptEvent[] = [];

    appendAgentTaskTranscriptEvent(transcript, envelope('toolResult', { result: 'x'.repeat(20_000) }));

    const stored = transcript[0].payload as { data: { payload: { result: string } } };

    expect(stored.data.payload.result).toHaveLength(AGENT_TASK_TRANSCRIPT_MAX_STRING_LENGTH + 1);

    for (let i = 0; i < AGENT_TASK_TRANSCRIPT_MAX_EVENTS + 10; i++) {
      appendAgentTaskTranscriptEvent(transcript, envelope('toolCall', { name: `t${i}` }), i);
    }

    expect(transcript).toHaveLength(AGENT_TASK_TRANSCRIPT_MAX_EVENTS);
    expect(transcript[transcript.length - 1].timestamp).toBe(AGENT_TASK_TRANSCRIPT_MAX_EVENTS + 9);
  });
});
