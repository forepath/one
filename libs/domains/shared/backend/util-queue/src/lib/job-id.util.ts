/** Allowed in BullMQ custom job IDs: `.` `-` `_` `~` (and alphanumeric). */
const JOB_ID_SEPARATOR = '.';

const ALLOWED_JOB_ID_PATTERN = /^[a-zA-Z0-9._~-]+$/;

/** Replaces characters outside BullMQ's allowed jobId set. */
const DISALLOWED_JOB_ID_CHAR = /[^a-zA-Z0-9._~-]/g;

/**
 * Normalizes a segment for BullMQ custom job IDs.
 * Colons are reserved by BullMQ for repeatable-job keys and are rejected otherwise.
 */
export function sanitizeJobIdSegment(value: string): string {
  return value
    .trim()
    .replace(/:/g, JOB_ID_SEPARATOR)
    .replace(/\//g, JOB_ID_SEPARATOR)
    .replace(/\s+/g, '-')
    .replace(DISALLOWED_JOB_ID_CHAR, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+|\.+$/g, '');
}

/** Validates a BullMQ custom jobId (see bullmq Job.validateOptions). */
export function assertValidBullMqJobId(jobId: string): void {
  if (!jobId.length) {
    throw new Error('BullMQ jobId must not be empty');
  }

  if (jobId.includes(':')) {
    throw new Error(`BullMQ jobId must not contain ':' (got: ${jobId})`);
  }

  if (`${parseInt(jobId, 10)}` === jobId) {
    throw new Error(`BullMQ jobId must not be an integer (got: ${jobId})`);
  }

  if (!ALLOWED_JOB_ID_PATTERN.test(jobId)) {
    throw new Error(`BullMQ jobId may only contain alphanumerics and . - _ ~ (got: ${jobId})`);
  }
}

/** Builds a stable BullMQ jobId for deduplication (only one active/waiting job per id). */
export function buildJobId(namespace: string, ...parts: Array<string | number | undefined>): string {
  const segments = [
    sanitizeJobIdSegment(namespace),
    ...parts
      .filter((part) => part !== undefined && part !== null && String(part).length > 0)
      .map((part) => sanitizeJobIdSegment(String(part))),
  ].filter((segment) => segment.length > 0);

  const jobId = segments.join(JOB_ID_SEPARATOR);

  assertValidBullMqJobId(jobId);

  return jobId;
}

/** Stable jobId for repeatable coordinator jobs. */
export function buildCoordinatorJobId(name: string): string {
  return buildJobId('coordinator', name);
}
