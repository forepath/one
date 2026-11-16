import type { AgentHarnessEvent, AgentHarnessEventType } from './agent-harness.events';
import { readSseFrames, SseParser, type SseFrame } from './sse-reader';

/**
 * Relay format of harness events: Server-Sent Events with `event: <type>` and the JSON event as `data`. Used when an
 * application backend runs the harness (credentials and domain tools stay server-side) and streams the turn to its
 * own frontend.
 */
export const AGENT_HARNESS_RELAY_CONTENT_TYPE = 'text/event-stream; charset=utf-8';

const EVENT_TYPES: ReadonlySet<AgentHarnessEventType> = new Set<AgentHarnessEventType>([
  'turn.started',
  'text.delta',
  'text.done',
  'agent.activity',
  'tool.call',
  'tool.result',
  'turn.completed',
  'turn.failed',
]);

export function isAgentHarnessEvent(value: unknown): value is AgentHarnessEvent {
  return (
    !!value && typeof value === 'object' && EVENT_TYPES.has((value as { type?: unknown }).type as AgentHarnessEventType)
  );
}

/** One SSE frame of an event (JSON escapes line breaks, so a frame is always a single `data:` line). */
export function encodeAgentHarnessEvent(event: AgentHarnessEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

function toEvent(frame: SseFrame): AgentHarnessEvent | undefined {
  try {
    const parsed: unknown = JSON.parse(frame.data);

    return isAgentHarnessEvent(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Incremental decoder of relayed events from text chunks (e.g. Angular `HttpDownloadProgressEvent.partialText`
 * deltas). Unknown or malformed frames are skipped.
 */
export class AgentHarnessEventDecoder {
  private readonly parser = new SseParser();

  push(text: string, final = false): AgentHarnessEvent[] {
    return this.parser.push(text, final).flatMap((frame) => {
      const event = toEvent(frame);

      return event ? [event] : [];
    });
  }
}

/** Reads relayed harness events; unknown or malformed frames are skipped. */
export async function* readAgentHarnessEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<AgentHarnessEvent> {
  for await (const frame of readSseFrames(body)) {
    const event = toEvent(frame);

    if (event) {
      yield event;
    }
  }
}
