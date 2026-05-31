/** BullMQ error codes for duplicate or conflicting job ids (see bullmq ErrorCode). */
const SCHEDULER_JOB_ID_COLLISION = -10;
const PARENT_JOB_CANNOT_BE_REPLACED = -7;

/** Returns true when BullMQ rejected enqueue because an equivalent job already exists. */
export function isDuplicateJobEnqueueError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const code = (error as Error & { code?: number }).code;

  if (code === SCHEDULER_JOB_ID_COLLISION || code === PARENT_JOB_CANNOT_BE_REPLACED) {
    return true;
  }

  const message = error.message.toLowerCase();

  return message.includes('already exists') || message.includes('duplicated');
}
