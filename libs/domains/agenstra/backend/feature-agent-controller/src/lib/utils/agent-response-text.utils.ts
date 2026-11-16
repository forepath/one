/** Classification of a final agent chat response (`chatMessage` response or a persisted agent message). */
export type AgentResponseOutcome =
  | { kind: 'text'; text: string }
  | { kind: 'error'; message: string }
  /** Replaced by the agent-manager because an outgoing message filter dropped it. */
  | { kind: 'dropped' };

const DROPPED_RESULT = 'MESSAGE_DROPPED';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isErrorRecord(record: Record<string, unknown>): boolean {
  return record['is_error'] === true || String(record['subtype'] ?? '') === 'error' || record['type'] === 'error';
}

function stringifyResult(result: unknown): string {
  if (typeof result === 'string') {
    return result;
  }

  if (result === undefined || result === null) {
    return '';
  }

  return JSON.stringify(result);
}

function errorMessage(record: Record<string, unknown>): string {
  const message = record['message'] ?? record['result'];

  return typeof message === 'string' && message.trim() ? message.trim() : 'The agent reported an error';
}

/**
 * Final answer of an agent response as the console shows it: plain strings, `result` frames and the last `result`
 * part of an `agenstra_turn` (tool history and intermediate parts are not part of the answer).
 */
export function classifyAgentResponse(response: unknown): AgentResponseOutcome {
  if (typeof response === 'string') {
    return { kind: 'text', text: response };
  }

  if (!isRecord(response)) {
    return { kind: 'text', text: '' };
  }

  if (isErrorRecord(response)) {
    return response['result'] === DROPPED_RESULT
      ? { kind: 'dropped' }
      : { kind: 'error', message: errorMessage(response) };
  }

  if (String(response['type']) === 'agenstra_turn' && Array.isArray(response['parts'])) {
    const parts = response['parts'] as unknown[];

    for (let i = parts.length - 1; i >= 0; i--) {
      const part = parts[i];

      if (isRecord(part) && String(part['type']) === 'result') {
        return isErrorRecord(part)
          ? { kind: 'error', message: errorMessage(part) }
          : { kind: 'text', text: stringifyResult(part['result']) };
      }
    }

    return { kind: 'text', text: '' };
  }

  if ('result' in response) {
    return { kind: 'text', text: stringifyResult(response['result']) };
  }

  if (typeof response['text'] === 'string') {
    return { kind: 'text', text: response['text'] };
  }

  return { kind: 'text', text: '' };
}

/**
 * Persisted agent message (`agent_messages.message`): the JSON-serialized response object, or plain text.
 */
export function classifyPersistedAgentMessage(message: string): AgentResponseOutcome {
  const trimmed = message.trim();

  if (trimmed.startsWith('{')) {
    try {
      return classifyAgentResponse(JSON.parse(trimmed));
    } catch {
      // Not JSON: plain text answer.
    }
  }

  return { kind: 'text', text: message };
}
