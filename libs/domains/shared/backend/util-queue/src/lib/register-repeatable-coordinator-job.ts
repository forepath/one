import type { JobsOptions, Queue, RepeatOptions } from 'bullmq';

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

function buildRepeatOptions(options: RegisterRepeatableCoordinatorJobOptions): Omit<RepeatOptions, 'key'> {
  if (options.pattern) {
    return options.tz ? { pattern: options.pattern, tz: options.tz } : { pattern: options.pattern };
  }

  if (options.everyMs != null && options.everyMs > 0) {
    return { every: options.everyMs };
  }

  throw new Error(`Repeatable job "${options.name}" requires everyMs or pattern`);
}

/**
 * Removes legacy repeatable jobs (created with `queue.add(..., { repeat })`) for this coordinator.
 *
 * Job schedulers and legacy repeatables share BullMQ's `repeat` set. A scheduler is keyed by its id
 * (the coordinator job id); legacy entries are keyed by an md5 hash or by the old
 * `name:jobId:endDate:tz:pattern` string, so every matching entry under a different key is legacy.
 *
 * BullMQ 6 drops legacy repeatables (and `removeRepeatableByKey`). Once every deployment has
 * started once with this code, this cleanup can be deleted as part of the BullMQ 6 upgrade.
 */
async function removeLegacyRepeatables(queue: Queue, name: string, coordinatorJobId: string): Promise<void> {
  const entries = await queue.getJobSchedulers();
  const legacy = entries.filter(
    (entry) => entry.key && entry.key !== coordinatorJobId && (entry.name === name || entry.id === coordinatorJobId),
  );

  for (const entry of legacy) {
    await queue.removeRepeatableByKey(entry.key);
  }
}

/**
 * Removes the job scheduler for this coordinator, plus any legacy repeatable job left from before the
 * scheduler migration.
 */
export async function removeRepeatableCoordinatorJob(
  queue: Queue,
  name: string,
  coordinatorJobId: string,
): Promise<void> {
  await removeLegacyRepeatables(queue, name, coordinatorJobId);
  await queue.removeJobScheduler(coordinatorJobId);
}

/**
 * Registers a coordinator job scheduler idempotently, using the coordinator job id as scheduler id.
 * Legacy repeatables for the same job name or coordinator job id are removed first, so a deployment
 * that still has them does not run the coordinator twice.
 */
export async function registerRepeatableCoordinatorJob(
  options: RegisterRepeatableCoordinatorJobOptions,
): Promise<void> {
  const repeat = buildRepeatOptions(options);

  await removeLegacyRepeatables(options.queue, options.name, options.coordinatorJobId);

  await options.queue.upsertJobScheduler(options.coordinatorJobId, repeat, {
    name: options.name,
    data: {},
    opts: {
      removeOnComplete: options.removeOnComplete ?? defaultRemoveOnComplete,
      removeOnFail: options.removeOnFail ?? defaultRemoveOnFail,
    },
  });
}
