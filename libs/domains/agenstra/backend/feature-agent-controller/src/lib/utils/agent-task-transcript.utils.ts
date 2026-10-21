/** One forwarded `chatEvent` of a task run (same shape the console renders for plan timelines). */
export interface AgentTaskTranscriptEvent {
  payload: unknown;
  timestamp: number;
}

/** Events kept per run (oldest dropped first). */
export const AGENT_TASK_TRANSCRIPT_MAX_EVENTS = 400;

/** Long strings (tool output, file contents) are cut to keep run rows bounded. */
export const AGENT_TASK_TRANSCRIPT_MAX_STRING_LENGTH = 8_000;

/** Streaming fragments are superseded by the terminal `assistantMessage`, so they are not stored. */
const SKIPPED_KINDS = new Set(['assistantDelta']);

/** `kind` of a forwarded chat event (`{ success, data: envelope }` or a bare envelope). */
export function agentTaskTranscriptEventKind(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    return '';
  }

  const record = payload as { kind?: unknown; data?: { kind?: unknown } };
  const kind = record.data && typeof record.data === 'object' ? record.data.kind : record.kind;

  return typeof kind === 'string' ? kind : '';
}

function compactValue(value: unknown, depth: number): unknown {
  if (typeof value === 'string') {
    return value.length > AGENT_TASK_TRANSCRIPT_MAX_STRING_LENGTH
      ? `${value.slice(0, AGENT_TASK_TRANSCRIPT_MAX_STRING_LENGTH)}…`
      : value;
  }

  if (!value || typeof value !== 'object' || depth > 8) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => compactValue(entry, depth + 1));
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, compactValue(entry, depth + 1)]),
  );
}

/** Append a chat event to a run transcript (skips deltas, bounds strings and the event count). */
export function appendAgentTaskTranscriptEvent(
  transcript: AgentTaskTranscriptEvent[],
  payload: unknown,
  timestamp: number = Date.now(),
): boolean {
  const kind = agentTaskTranscriptEventKind(payload);

  if (!kind || SKIPPED_KINDS.has(kind)) {
    return false;
  }

  transcript.push({ payload: compactValue(payload, 0), timestamp });

  if (transcript.length > AGENT_TASK_TRANSCRIPT_MAX_EVENTS) {
    transcript.splice(0, transcript.length - AGENT_TASK_TRANSCRIPT_MAX_EVENTS);
  }

  return true;
}
