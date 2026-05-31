import type { Queue } from 'bullmq';

import { defaultRemoveOnComplete, defaultRemoveOnFail } from './job-retention';
import { enqueueUnitJob } from './enqueue-unit-job';

describe('enqueueUnitJob', () => {
  it('adds a unit job with a stable job id', async () => {
    const add = jest.fn().mockResolvedValue({ id: 'billing.subscription.abc' });
    const queue = { add } as unknown as Queue;

    await enqueueUnitJob({
      queue,
      jobName: 'billing.subscription.unit',
      payload: { subscriptionId: 'abc' },
      jobIdNamespace: 'billing.subscription',
      jobIdParts: ['abc'],
    });

    expect(add).toHaveBeenCalledWith(
      'billing.subscription.unit',
      { subscriptionId: 'abc' },
      expect.objectContaining({
        jobId: 'billing.subscription.abc',
        removeOnComplete: defaultRemoveOnComplete,
        removeOnFail: defaultRemoveOnFail,
      }),
    );
  });

  it('ignores duplicate job enqueue errors', async () => {
    const duplicateError = new Error('Job ID already exists');

    (duplicateError as Error & { code?: number }).code = -10;

    const add = jest.fn().mockRejectedValue(duplicateError);
    const queue = { add } as unknown as Queue;

    await expect(
      enqueueUnitJob({
        queue,
        jobName: 'billing.subscription.unit',
        payload: { subscriptionId: 'abc' },
        jobIdNamespace: 'billing.subscription',
        jobIdParts: ['abc'],
      }),
    ).resolves.toBeUndefined();
  });

  it('rethrows non-duplicate errors', async () => {
    const add = jest.fn().mockRejectedValue(new Error('Redis connection lost'));
    const queue = { add } as unknown as Queue;

    await expect(
      enqueueUnitJob({
        queue,
        jobName: 'billing.subscription.unit',
        payload: { subscriptionId: 'abc' },
        jobIdNamespace: 'billing.subscription',
        jobIdParts: ['abc'],
      }),
    ).rejects.toThrow('Redis connection lost');
  });
});
