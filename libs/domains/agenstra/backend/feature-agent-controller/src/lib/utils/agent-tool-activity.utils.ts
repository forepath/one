/**
 * Read-only view of the tools an agent ran in its own workspace during a chat turn (OpenAI-compatible API).
 *
 * Built either from live `toolCall` / `toolResult` chat events (only when live streaming is allowed, see
 * `OpenAiCompatibleService.canStreamDeltas`) or from the `tool_call` / `tool_result` parts of the final, filtered
 * agent response. Tool activity is informational: clients never receive anything they are expected to execute.
 */

export type AgentToolActivityStatus = 'in_progress' | 'completed' | 'failed';

export interface AgentToolActivity {
  /** Agent tool call id (stable across call / result). */
  id: string;
  name: string;
  /** JSON-serialized arguments (truncated). */
  arguments: string;
  /** Tool output (truncated); null while running. */
  output: string | null;
  status: AgentToolActivityStatus;
}

/** Per-field cap for tool arguments / outputs exposed through the API (file reads can be huge). */
export const TOOL_ACTIVITY_MAX_CHARS = 4000;

/** Agenstra-internal pseudo tool (context injection) - not agent workspace activity. */
const INTERNAL_TOOL_NAMES = new Set(['enrichment']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function truncateToolText(text: string, max = TOOL_ACTIVITY_MAX_CHARS): string {
  return text.length > max ? `${text.slice(0, max)}… [truncated ${text.length - max} characters]` : text;
}

function serialize(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Tool arguments as text; empty objects count as "not known yet" (some runtimes only report them with the result). */
function argumentsText(value: unknown): string {
  if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) {
    return '';
  }

  return truncateToolText(serialize(value));
}

function callStatus(status: unknown): AgentToolActivityStatus {
  return status === 'failed' ? 'failed' : status === 'succeeded' ? 'completed' : 'in_progress';
}

/**
 * Accumulates tool activity in call order. Results complete the matching call (or create an entry when the call was
 * not seen, e.g. results without a preceding call event).
 */
export class AgentToolActivityTracker {
  private readonly entries = new Map<string, AgentToolActivity>();

  /** Applies a tool call; returns the entry when it is new. */
  call(id: string, name: string, args: unknown, status?: unknown): AgentToolActivity | undefined {
    if (!id || INTERNAL_TOOL_NAMES.has(name)) {
      return undefined;
    }

    const existing = this.entries.get(id);
    const callArguments = argumentsText(args);

    if (existing) {
      if (callArguments && !existing.arguments) {
        existing.arguments = callArguments;
      }

      if (existing.status === 'in_progress' && status === 'failed') {
        existing.status = 'failed';
      }

      return undefined;
    }

    const entry: AgentToolActivity = {
      id,
      name: name || 'tool',
      arguments: callArguments,
      output: null,
      status: callStatus(status) === 'failed' ? 'failed' : 'in_progress',
    };

    this.entries.set(id, entry);

    return entry;
  }

  /** Applies a tool result; returns the completed entry (created when the call was not seen). */
  result(id: string, name: string, result: unknown, isError: boolean, args?: unknown): AgentToolActivity | undefined {
    if (!id || INTERNAL_TOOL_NAMES.has(name)) {
      return undefined;
    }

    let entry = this.entries.get(id);

    if (!entry) {
      entry = { id, name: name || 'tool', arguments: '', output: null, status: 'in_progress' };
      this.entries.set(id, entry);
    }

    if (!entry.arguments && args !== undefined) {
      entry.arguments = argumentsText(args);
    }

    entry.output = truncateToolText(serialize(result));
    entry.status = isError ? 'failed' : 'completed';

    return entry;
  }

  list(): AgentToolActivity[] {
    return [...this.entries.values()];
  }
}

/** Tool activity of a final agent response (`agenstra_turn` parts). */
export function collectToolActivity(response: unknown): AgentToolActivity[] {
  const tracker = new AgentToolActivityTracker();

  if (!isRecord(response) || !Array.isArray(response['parts'])) {
    return [];
  }

  for (const part of response['parts'] as unknown[]) {
    if (!isRecord(part) || typeof part['toolCallId'] !== 'string') {
      continue;
    }

    const type = String(part['type']);
    const name = typeof part['name'] === 'string' ? part['name'] : 'tool';

    if (type === 'tool' || type === 'tool_call') {
      tracker.call(part['toolCallId'], name, part['args'], part['status']);
    } else if (type === 'tool_result') {
      tracker.result(part['toolCallId'], name, part['result'], part['isError'] === true, part['args']);
    }
  }

  return tracker.list();
}

/** One-line human-readable summary (Chat Completions `reasoning_content`). */
export function summarizeToolActivity(activity: AgentToolActivity): string {
  const args = activity.arguments ? ` ${truncateToolText(activity.arguments, 300)}` : '';
  const outcome = activity.status === 'failed' ? 'failed' : activity.status === 'completed' ? 'done' : 'running';

  return `[agent tool] ${activity.name}${args} → ${outcome}`;
}

/** Applies a live `toolCall` / `toolResult` chat event payload; returns the new (call) or completed (result) entry. */
export function applyToolEvent(
  tracker: AgentToolActivityTracker,
  event: { kind: 'toolCall' | 'toolResult'; payload: Record<string, unknown> },
): AgentToolActivity | undefined {
  const payload = event.payload;
  const id = typeof payload['toolCallId'] === 'string' ? payload['toolCallId'] : '';
  const name = typeof payload['name'] === 'string' ? payload['name'] : 'tool';

  if (event.kind === 'toolCall') {
    return tracker.call(id, name, payload['args'], payload['status']);
  }

  return tracker.result(id, name, payload['result'], payload['isError'] === true, payload['args']);
}
