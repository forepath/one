import type { JobsOptions, Queue } from 'bullmq';

import { defaultRemoveOnComplete, defaultRemoveOnFail } from './job-retention';

export interface RegisterRepeatableCoordinatorJobOptions {
  queue: Queue;
  name: string;
  coordinatorJobId: string;
  everyMs: number;
  removeOnComplete?: JobsOptions['removeOnComplete'];
  removeOnFail?: JobsOptions['removeOnFail'];
}

/**
 * Registers a coordinator repeatable job idempotently.
 * Removes stale repeatables for the same job name or coordinator job id before adding.
 */
export async function registerRepeatableCoordinatorJob(
  options: RegisterRepeatableCoordinatorJobOptions,
): Promise<void> {
  const repeatables = await options.queue.getRepeatableJobs();
  const stale = repeatables.filter((job) => job.name === options.name || job.id === options.coordinatorJobId);

  for (const job of stale) {
    if (job.key) {
      await options.queue.removeRepeatableByKey(job.key);
    }
  }

  await options.queue.add(
    options.name,
    {},
    {
      jobId: options.coordinatorJobId,
      repeat: { every: options.everyMs },
      removeOnComplete: options.removeOnComplete ?? defaultRemoveOnComplete,
      removeOnFail: options.removeOnFail ?? defaultRemoveOnFail,
    },
  );
}
