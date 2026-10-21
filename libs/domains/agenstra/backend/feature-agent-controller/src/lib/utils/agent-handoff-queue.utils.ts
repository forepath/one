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
 */
export async function enqueueAgentHandoff(queue: Queue, job: AgentHandoffJob): Promise<void> {
  await enqueueUnitJob({
    queue,
    jobName: AGENT_HANDOFF_UNIT_JOB_NAME,
    payload: job,
    jobIdNamespace: AGENT_HANDOFF_UNIT_JOB_ID_NAMESPACE,
    jobIdParts: [job.handoffId],
  });
}
