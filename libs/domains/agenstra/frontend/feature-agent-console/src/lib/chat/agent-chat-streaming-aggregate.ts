import { mapForwardedChatEventToDisplayRow, tryParseChatEventEnvelope } from './agent-chat-event-display';
import { consolidateAgentTurnSegments, type AgentTurnSegment } from './chat-thread-display';

export interface StreamingTurnAccumulated {
  segments: AgentTurnSegment[];
}

/**
 * Fold forwarded `chatEvent` rows for the current user turn into ordered segments (structured rows
 * and assistant markdown interleaved as events arrive). Events at or before `lastUserClientTimestamp`
 * are ignored so prior turns do not leak into the live preview.
 */
export function accumulateStreamingTurnFromEvents(
  orderedEvents: ReadonlyArray<{ payload: unknown; timestamp: number }>,
  lastUserClientTimestamp: number,
): StreamingTurnAccumulated {
  const segments: AgentTurnSegment[] = [];
  let markdownSeq = 0;
  const appendMarkdownDelta = (delta: string): void => {
    if (delta.length === 0) {
      return;
    }

    const last = segments[segments.length - 1];

    if (last?.kind === 'markdown') {
      last.markdown += delta;
    } else {
      segments.push({
        kind: 'markdown',
        markdown: delta,
        trackId: `stream-md-${lastUserClientTimestamp}-${markdownSeq++}`,
      });
    }
  };
  const setAssistantMessageText = (full: string): void => {
    if (full.length === 0) {
      return;
    }

    const last = segments[segments.length - 1];

    if (last?.kind === 'markdown') {
      last.markdown = full;
    } else {
      segments.push({
        kind: 'markdown',
        markdown: full,
        trackId: `stream-md-${lastUserClientTimestamp}-${markdownSeq++}`,
      });
    }
  };

  for (const ev of orderedEvents) {
    if (ev.timestamp <= lastUserClientTimestamp) {
      continue;
    }

    const envelope = tryParseChatEventEnvelope(ev.payload);

    if (!envelope) {
      continue;
    }

    switch (envelope.kind) {
      case 'userMessage':
        break;

      case 'thinking': {
        const row = mapForwardedChatEventToDisplayRow(ev);

        if (row) {
          segments.push({ kind: 'row', row });
        }

        break;
      }

      case 'interactionQuery': {
        const row = mapForwardedChatEventToDisplayRow(ev);

        if (row) {
          segments.push({ kind: 'row', row });
        }

        break;
      }

      case 'assistantDelta': {
        const delta =
          typeof (envelope.payload as { delta?: unknown }).delta === 'string'
            ? (envelope.payload as { delta: string }).delta
            : '';

        appendMarkdownDelta(delta);
        break;
      }

      case 'assistantMessage': {
        const full =
          typeof (envelope.payload as { text?: unknown }).text === 'string'
            ? (envelope.payload as { text: string }).text
            : '';

        setAssistantMessageText(full);
        break;
      }

      default: {
        const row = mapForwardedChatEventToDisplayRow(ev);

        if (row) {
          segments.push({ kind: 'row', row });
        }

        break;
      }
    }
  }

  return { segments: consolidateAgentTurnSegments(segments) };
}
