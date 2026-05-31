import type { JobsOptions, Queue } from 'bullmq';

import { isDuplicateJobEnqueueError } from './is-duplicate-job-enqueue-error';
import { defaultRemoveOnComplete, defaultRemoveOnFail } from './job-retention';
import { buildJobId } from './job-id.util';

export interface EnqueueUnitJobOptions<T> {
  queue: Queue;
  jobName: string;
  payload: T;
  jobIdNamespace: string;
  jobIdParts: Array<string | number | undefined>;
  opts?: Omit<JobsOptions, 'jobId'>;
}

/** Enqueues a unit job with a stable jobId to prevent duplicate processing. */
export async function enqueueUnitJob<T>(options: EnqueueUnitJobOptions<T>): Promise<void> {
  const jobId = buildJobId(options.jobIdNamespace, ...options.jobIdParts);

  try {
    await options.queue.add(options.jobName, options.payload, {
      jobId,
      removeOnComplete: defaultRemoveOnComplete,
      removeOnFail: defaultRemoveOnFail,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      ...options.opts,
    });
  } catch (error) {
    if (isDuplicateJobEnqueueError(error)) {
      return;
    }

    throw error;
  }
}
