import { mapForwardedChatEventsToDisplayRows, type AgentChatEventDisplayRow } from '../chat/agent-chat-event-display';
import { buildAgentChatHandoffCard, type AgentChatHandoffCardView } from '../chat/agent-chat-handoff-view';

export interface AgentTaskTranscriptEventLike {
  payload: unknown;
  timestamp: number;
}

/**
 * Chat-like view of one run: answers as bubbles, tools / thinking as the usual event rows. The run prompt (the
 * platform-generated user message) is not shown; the task instructions are displayed above the history instead.
 * Responses to the run's handoffs (delivered as messages into the run's session) are shown as cards.
 */
export type AgentTaskTranscriptSegment =
  | { kind: 'assistant'; trackId: string; text: string; timestamp: number }
  | { kind: 'events'; trackId: string; rows: AgentChatEventDisplayRow[] }
  | {
      kind: 'handoffResponse';
      trackId: string;
      card: AgentChatHandoffCardView & { kind: 'response' };
      timestamp: number;
    };

function envelopeOf(payload: unknown): { eventId?: unknown; kind?: unknown; payload?: unknown } | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const record = payload as { data?: unknown; kind?: unknown };
  const envelope = record.data && typeof record.data === 'object' ? record.data : record;

  return envelope as { eventId?: unknown; kind?: unknown; payload?: unknown };
}

function messageText(envelope: { payload?: unknown }): string {
  const text = (envelope.payload as { text?: unknown } | undefined)?.text;

  return typeof text === 'string' ? text.trim() : '';
}

/**
 * Turn a stored run transcript into display segments. Consecutive non-message events are grouped and consolidated
 * exactly like the chat plan timeline (thinking / tool pairs merged).
 */
export function buildAgentTaskTranscriptSegments(events: AgentTaskTranscriptEventLike[]): AgentTaskTranscriptSegment[] {
  const segments: AgentTaskTranscriptSegment[] = [];
  let pending: AgentTaskTranscriptEventLike[] = [];
  const flush = () => {
    if (pending.length === 0) {
      return;
    }

    const rows = mapForwardedChatEventsToDisplayRows(pending);

    if (rows.length > 0) {
      segments.push({ kind: 'events', trackId: `events-${rows[0].trackId}`, rows });
    }

    pending = [];
  };

  for (const [index, event] of events.entries()) {
    const envelope = envelopeOf(event.payload);
    const kind = envelope?.kind;

    if (envelope && kind === 'userMessage') {
      const card = buildAgentChatHandoffCard(messageText(envelope));

      if (card?.kind === 'response') {
        flush();
        segments.push({
          kind: 'handoffResponse',
          trackId: `handoff-${card.handoffId}-${event.timestamp}`,
          card: card as AgentChatHandoffCardView & { kind: 'response' },
          timestamp: event.timestamp,
        });
      }

      continue;
    }

    if (envelope && kind === 'assistantMessage') {
      const text = messageText(envelope);

      if (!text) {
        continue;
      }

      flush();
      segments.push({
        kind: 'assistant',
        trackId: `${String(envelope.eventId ?? index)}-${event.timestamp}`,
        text,
        timestamp: event.timestamp,
      });
      continue;
    }

    pending.push(event);
  }

  flush();

  return segments;
}
