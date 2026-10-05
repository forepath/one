import {
  isAgenstraAutomationTurnStatus,
  parseAgenstraAutomationTurnStatus,
  type AgenstraAutomationTurnStatus,
} from '@forepath/agenstra/shared/util-opencode-config';

export type { AgenstraAutomationTurnStatus };

export const AGENSTRA_AUTOMATION_TURN_STATUS = {
  CONTINUE: 'continue',
  COMPLETE: 'complete',
} as const;

/**
 * Extract automation turn status from a sync chatMessage envelope or agent response object.
 */
export function extractAutomationTurnStatus(payload: unknown): AgenstraAutomationTurnStatus | undefined {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }

  const envelope = payload as {
    success?: boolean;
    data?: { from?: string; response?: unknown };
    automationTurnStatus?: unknown;
  };

  if (envelope.automationTurnStatus !== undefined) {
    return parseAgenstraAutomationTurnStatus(envelope.automationTurnStatus);
  }

  const response = envelope.data?.response ?? envelope;

  if (!response || typeof response !== 'object') {
    return undefined;
  }

  const record = response as Record<string, unknown>;

  if (record['automationTurnStatus'] !== undefined) {
    return parseAgenstraAutomationTurnStatus(record['automationTurnStatus']);
  }

  if (record['type'] === 'result' && record['result'] !== undefined && typeof record['result'] !== 'string') {
    return parseAgenstraAutomationTurnStatus(record['result']);
  }

  if (record['type'] === 'agenstra_turn' && Array.isArray(record['parts'])) {
    for (const part of record['parts']) {
      const status = extractAutomationTurnStatus(part);

      if (status) {
        return status;
      }
    }
  }

  return undefined;
}

export function isAutomationTurnComplete(status: AgenstraAutomationTurnStatus | undefined): boolean {
  return status === AGENSTRA_AUTOMATION_TURN_STATUS.COMPLETE;
}

export function coerceAutomationTurnStatus(value: unknown): AgenstraAutomationTurnStatus | undefined {
  return isAgenstraAutomationTurnStatus(value) ? value : parseAgenstraAutomationTurnStatus(value);
}
