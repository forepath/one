import {
  BULL_BOARD_JOB_RETENTION_AGE_SECONDS,
  BULL_BOARD_JOB_RETENTION_COUNT,
  defaultRemoveOnComplete,
  defaultRemoveOnFail,
} from './job-retention';

describe('job retention defaults', () => {
  it('disables automatic removal of completed and failed jobs', () => {
    expect(defaultRemoveOnComplete).toBe(false);
    expect(defaultRemoveOnFail).toBe(false);
  });

  it('documents the minimum Bull Board visibility policy', () => {
    expect(BULL_BOARD_JOB_RETENTION_COUNT).toBe(3);
    expect(BULL_BOARD_JOB_RETENTION_AGE_SECONDS).toBe(48 * 60 * 60);
  });
});
