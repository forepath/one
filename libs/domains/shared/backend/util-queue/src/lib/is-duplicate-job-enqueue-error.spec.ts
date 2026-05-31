import { isDuplicateJobEnqueueError } from './is-duplicate-job-enqueue-error';

describe('isDuplicateJobEnqueueError', () => {
  it('returns true for BullMQ scheduler job id collision code', () => {
    const error = new Error('Cannot create job scheduler iteration - job ID already exists. addJob');

    (error as Error & { code?: number }).code = -10;

    expect(isDuplicateJobEnqueueError(error)).toBe(true);
  });

  it('returns true for parent job replacement collision code', () => {
    const error = new Error('The parent job parent cannot be replaced. addJob');

    (error as Error & { code?: number }).code = -7;

    expect(isDuplicateJobEnqueueError(error)).toBe(true);
  });

  it('returns true when message mentions already exists or duplicated', () => {
    expect(isDuplicateJobEnqueueError(new Error('Job ID already exists'))).toBe(true);
    expect(isDuplicateJobEnqueueError(new Error('event duplicated'))).toBe(true);
  });

  it('returns false for unrelated errors', () => {
    expect(isDuplicateJobEnqueueError(new Error('Connection refused'))).toBe(false);
    expect(isDuplicateJobEnqueueError('not an error')).toBe(false);
  });
});
