import { enqueueUnitJob } from '@forepath/shared/backend';
import type { Queue } from 'bullmq';

import {
  AGENT_HANDOFF_UNIT_JOB_ID_NAMESPACE,
  AGENT_HANDOFF_UNIT_JOB_NAME,
} from '../constants/agent-handoffs.constants';

/** Payload of {@link AGENT_HANDOFF_UNIT_JOB_NAME}. */
export interface AgentHandoffJob {
  handoffId: string;
}

/**
 * Enqueue the unit of one handoff. The stable jobId drops duplicates while a unit is in flight; the unit itself
 * continues from the stored state (target turn, then delivery), so re-enqueueing a finished unit is safe.
 * `delivery`: a separate jobId for deliveries that must not wait for a unit still in flight (a task run that
 * stopped waiting, a response that arrived while the run's own turn was still working); both units deliver at most
 * once because the run is claimed atomically.
 */
export async function enqueueAgentHandoff(
  queue: Queue,
  job: AgentHandoffJob,
  options: { delivery?: boolean } = {},
): Promise<void> {
  await enqueueUnitJob({
    queue,
    jobName: AGENT_HANDOFF_UNIT_JOB_NAME,
    payload: job,
    jobIdNamespace: AGENT_HANDOFF_UNIT_JOB_ID_NAMESPACE,
    jobIdParts: options.delivery ? [job.handoffId, 'delivery'] : [job.handoffId],
  });
}

/** `userMessage` chat event of our own delivery turn (the manager accepted the message). */
export function isAgentHandoffDeliveryAccepted(event: unknown, correlationId: string): boolean {
  if (!event || typeof event !== 'object') {
    return false;
  }

  const envelope = event as { data?: { kind?: unknown; correlationId?: unknown } };
  const data = envelope.data ?? (event as { kind?: unknown; correlationId?: unknown });

  return data.kind === 'userMessage' && data.correlationId === correlationId;
}

export function agentHandoffDeliveryCorrelationId(handoffId: string): string {
  return `agent-handoff:${handoffId}:response`;
}
