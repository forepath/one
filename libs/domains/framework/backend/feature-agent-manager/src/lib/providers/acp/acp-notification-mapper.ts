import type { SessionNotification } from '@agentclientprotocol/sdk';

import type { AgentResponseObject } from '../agent-provider.interface';

/**
 * Maps ACP session/update notifications to unified agent response objects
 * consumed by {@link AgentsGateway}.
 */
export class AcpNotificationMapper {
  mapSessionUpdate(notification: SessionNotification): AgentResponseObject[] {
    const update = notification.update;
    const results: AgentResponseObject[] = [];

    switch (update.sessionUpdate) {
      case 'agent_message_chunk':
        if (update.content.type === 'text' && update.content.text) {
          results.push({ type: 'delta', delta: update.content.text });
        }

        break;
      case 'agent_thought_chunk':
        results.push({ type: 'thinking', phase: 'running' });
        break;
      case 'tool_call':
        results.push({
          type: 'tool_call',
          toolCallId: update.toolCallId,
          name: update.title ?? 'tool',
          status: mapAcpToolStatus(update.status),
        });
        break;
      case 'tool_call_update':
        if (update.status === 'completed' || update.status === 'failed') {
          results.push({
            type: 'tool_result',
            toolCallId: update.toolCallId,
            name: update.title ?? 'tool',
            result: update.status,
            isError: update.status === 'failed',
          });
        } else {
          results.push({
            type: 'tool_call',
            toolCallId: update.toolCallId,
            name: update.title ?? 'tool',
            status: mapAcpToolStatus(update.status),
          });
        }

        break;
      case 'plan':
        results.push({ type: 'thinking', phase: 'plan' });
        break;
      default:
        break;
    }

    return results;
  }

  /**
   * Build a terminal success payload from accumulated assistant text.
   */
  buildFinalResult(aggregatedText: string, sessionId?: string): AgentResponseObject {
    return {
      type: 'result',
      subtype: 'success',
      result: aggregatedText,
      ...(sessionId ? { session_id: sessionId } : {}),
    };
  }
}

function mapAcpToolStatus(status: string): 'started' | 'inProgress' | 'succeeded' | 'failed' {
  if (status === 'completed') {
    return 'succeeded';
  }

  if (status === 'failed') {
    return 'failed';
  }

  if (status === 'pending') {
    return 'started';
  }

  return 'inProgress';
}
