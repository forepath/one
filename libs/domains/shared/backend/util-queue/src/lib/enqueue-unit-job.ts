import type { JobsOptions, Queue } from 'bullmq';

import { isDuplicateJobEnqueueError } from './is-duplicate-job-enqueue-error';
import { buildJobId } from './job-id.util';
import { defaultRemoveOnComplete, defaultRemoveOnFail } from './job-retention';

export interface EnqueueUnitJobOptions<T> {
  queue: Queue;
  jobName: string;
  payload: T;
  jobIdNamespace: string;
  jobIdParts: Array<string | number | undefined>;
  opts?: Omit<JobsOptions, 'jobId'>;
}

const TERMINAL_JOB_STATES = new Set(['completed', 'failed']);

/**
 * Enqueues a unit job with a stable jobId to prevent duplicate in-flight processing.
 * BullMQ 5 returns an existing custom jobId as a successful no-op (no throw), so finished
 * jobs must be removed before add or coordinators never recur.
 */
export async function enqueueUnitJob<T>(options: EnqueueUnitJobOptions<T>): Promise<void> {
  const jobId = buildJobId(options.jobIdNamespace, ...options.jobIdParts);
  const addOptions: JobsOptions = {
    jobId,
    removeOnComplete: defaultRemoveOnComplete,
    removeOnFail: defaultRemoveOnFail,
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    ...options.opts,
  };
  const existing = typeof options.queue.getJob === 'function' ? await options.queue.getJob(jobId) : undefined;

  if (existing) {
    const state = await existing.getState();

    if (!TERMINAL_JOB_STATES.has(state)) {
      return;
    }

    try {
      await existing.remove();
    } catch {
      return;
    }
  }

  await addIgnoringDuplicate(options.queue, options.jobName, options.payload, addOptions);
}

async function addIgnoringDuplicate<T>(
  queue: Queue,
  jobName: string,
  payload: T,
  addOptions: JobsOptions,
): Promise<void> {
  try {
    await queue.add(jobName, payload, addOptions);
  } catch (error) {
    if (isDuplicateJobEnqueueError(error)) {
      return;
    }

    throw error;
  }
}
