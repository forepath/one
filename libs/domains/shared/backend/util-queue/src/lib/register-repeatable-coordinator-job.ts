import type { JobsOptions, Queue } from 'bullmq';

import { defaultRemoveOnComplete, defaultRemoveOnFail } from './job-retention';

export interface RegisterRepeatableCoordinatorJobOptions {
  queue: Queue;
  name: string;
  coordinatorJobId: string;
  everyMs?: number;
  pattern?: string;
  tz?: string;
  removeOnComplete?: JobsOptions['removeOnComplete'];
  removeOnFail?: JobsOptions['removeOnFail'];
}

function buildRepeatOptions(options: RegisterRepeatableCoordinatorJobOptions): JobsOptions['repeat'] {
  if (options.pattern) {
    return options.tz ? { pattern: options.pattern, tz: options.tz } : { pattern: options.pattern };
  }

  if (options.everyMs != null && options.everyMs > 0) {
    return { every: options.everyMs };
  }

  throw new Error(`Repeatable job "${options.name}" requires everyMs or pattern`);
}

/**
 * Removes repeatable coordinator jobs matching name or coordinator job id.
 */
export async function removeRepeatableCoordinatorJob(
  queue: Queue,
  name: string,
  coordinatorJobId: string,
): Promise<void> {
  const repeatables = await queue.getRepeatableJobs();
  const stale = repeatables.filter((job) => job.name === name || job.id === coordinatorJobId);

  for (const job of stale) {
    if (job.key) {
      await queue.removeRepeatableByKey(job.key);
    }
  }
}

/**
 * Registers a coordinator repeatable job idempotently.
 * Removes stale repeatables for the same job name or coordinator job id before adding.
 */
export async function registerRepeatableCoordinatorJob(
  options: RegisterRepeatableCoordinatorJobOptions,
): Promise<void> {
  await removeRepeatableCoordinatorJob(options.queue, options.name, options.coordinatorJobId);

  await options.queue.add(
    options.name,
    {},
    {
      jobId: options.coordinatorJobId,
      repeat: buildRepeatOptions(options),
      removeOnComplete: options.removeOnComplete ?? defaultRemoveOnComplete,
      removeOnFail: options.removeOnFail ?? defaultRemoveOnFail,
    },
  );
}
