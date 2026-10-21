import type { AgentTaskRunTrigger } from '@forepath/agenstra/shared/util-opencode-config';
import { enqueueUnitJob } from '@forepath/shared/backend';
import type { Queue } from 'bullmq';

import { AGENT_TASK_UNIT_JOB_ID_NAMESPACE, AGENT_TASK_UNIT_JOB_NAME } from '../constants/agent-tasks.constants';

/** Payload of {@link AGENT_TASK_UNIT_JOB_NAME}. */
export interface AgentTaskOccurrence {
  taskId: string;
  /** ISO-8601; together with `taskId` identifies the occurrence (unique run row, stable jobId). */
  scheduledFor: string;
  trigger: AgentTaskRunTrigger;
}

/** Enqueue one occurrence; duplicates of an in-flight occurrence are dropped by the stable jobId. */
export async function enqueueAgentTaskOccurrence(queue: Queue, occurrence: AgentTaskOccurrence): Promise<void> {
  await enqueueUnitJob({
    queue,
    jobName: AGENT_TASK_UNIT_JOB_NAME,
    payload: occurrence,
    jobIdNamespace: AGENT_TASK_UNIT_JOB_ID_NAMESPACE,
    jobIdParts: [occurrence.taskId, Date.parse(occurrence.scheduledFor)],
  });
}
