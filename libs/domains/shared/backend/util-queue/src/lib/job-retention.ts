/** Documented minimum Bull Board visibility before any manual cleanup. */
export const BULL_BOARD_JOB_RETENTION_COUNT = 3;

/** Documented minimum Bull Board visibility in seconds (48 hours). */
export const BULL_BOARD_JOB_RETENTION_AGE_SECONDS = 48 * 60 * 60;

/**
 * Do not auto-remove completed jobs so Bull Board keeps run history.
 * Jobs should remain visible for at least the last three runs and 48 hours;
 * automatic trimming is disabled and cleanup is manual via Bull Board or ops.
 */
export const defaultRemoveOnComplete = false;

/** Do not auto-remove failed jobs so Bull Board keeps error history. */
export const defaultRemoveOnFail = false;
