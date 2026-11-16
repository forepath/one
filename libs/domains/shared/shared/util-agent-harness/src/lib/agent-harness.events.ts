import type { AgentToolExecutionStatus } from './tool-registry';

/** Token usage of a turn (summed over its tool rounds). */
export interface AgentTurnUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
}

/** A tool the agent ran in its own workspace (read-only; reported with `toolActivity`). */
export interface AgentActivity {
  id: string;
  name: string;
  arguments: string;
  output: string | null;
  error: string | null;
  status: 'in_progress' | 'completed' | 'failed';
}

export interface AgentToolCallSummary {
  callId: string;
  name: string;
  /** JSON arguments (omitted in redacted relays). */
  arguments?: string;
}

export interface AgentToolResultSummary {
  callId: string;
  name: string;
  status: AgentToolExecutionStatus;
  /** Output handed to the agent (omitted in redacted relays). */
  output?: string;
  error?: { message: string; code: string };
  durationMs: number;
}

export type AgentTurnStatus = 'completed' | 'incomplete';

/** Result of one user turn (one message plus all client tool rounds it caused). */
export interface AgentTurnResult {
  /** Final answer of the agent. */
  text: string;
  /** `incomplete`: the answer was dropped by an outgoing message filter. */
  status: AgentTurnStatus;
  /** `conv_…` id of the chat session the turn ran in. */
  conversationId: string | null;
  /** Chat session UUID. */
  chatId: string | null;
  /** Id of the last response (usable as `previous_response_id`). */
  responseId: string | null;
  model: string;
  rounds: number;
  toolCalls: AgentToolResultSummary[];
  activity: AgentActivity[];
  usage: AgentTurnUsage;
}

/**
 * Events of a harness turn. The same shape is used by relays (backend → browser), so it only contains plain JSON.
 */
export type AgentHarnessEvent =
  | { type: 'turn.started'; conversationId: string | null; chatId: string | null; round: number }
  | { type: 'text.delta'; delta: string }
  | { type: 'text.done'; text: string }
  | { type: 'agent.activity'; activity: AgentActivity }
  | { type: 'tool.call'; call: AgentToolCallSummary }
  | { type: 'tool.result'; result: AgentToolResultSummary }
  | { type: 'turn.completed'; result: AgentTurnResult }
  | { type: 'turn.failed'; error: { message: string; code: string | null; status: number | null } };

export type AgentHarnessEventType = AgentHarnessEvent['type'];

export function emptyUsage(): AgentTurnUsage {
  return { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0, totalTokens: 0 };
}

/**
 * Removes tool arguments and outputs from an event (default for relays to browsers: tool payloads may contain data
 * the end user must not see, e.g. records of other users that a tool filtered for the agent).
 */
export function redactAgentHarnessEvent(event: AgentHarnessEvent): AgentHarnessEvent {
  switch (event.type) {
    case 'tool.call':
      return { type: 'tool.call', call: { callId: event.call.callId, name: event.call.name } };

    case 'tool.result': {
      const { output: _output, ...rest } = event.result;

      return { type: 'tool.result', result: rest };
    }

    case 'turn.completed':
      return {
        type: 'turn.completed',
        result: {
          ...event.result,
          toolCalls: event.result.toolCalls.map(({ output: _output, ...rest }) => rest),
        },
      };
    default:
      return event;
  }
}
