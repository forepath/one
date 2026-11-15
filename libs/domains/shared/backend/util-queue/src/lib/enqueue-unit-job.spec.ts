import type { Queue } from 'bullmq';

import { enqueueUnitJob } from './enqueue-unit-job';
import { defaultRemoveOnComplete, defaultRemoveOnFail } from './job-retention';

describe('enqueueUnitJob', () => {
  it('adds a unit job with a stable job id', async () => {
    const add = jest.fn().mockResolvedValue({ id: 'billing.subscription.abc' });
    const queue = { add, getJob: jest.fn().mockResolvedValue(undefined) } as unknown as Queue;

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

  it('adds when the queue mock has no getJob', async () => {
    const add = jest.fn().mockResolvedValue({ id: 'billing.subscription.abc' });
    const queue = { add } as unknown as Queue;

    await enqueueUnitJob({
      queue,
      jobName: 'billing.subscription.unit',
      payload: { subscriptionId: 'abc' },
      jobIdNamespace: 'billing.subscription',
      jobIdParts: ['abc'],
    });

    expect(add).toHaveBeenCalledTimes(1);
  });

  it('ignores duplicate job enqueue errors', async () => {
    const duplicateError = new Error('Job ID already exists');

    (duplicateError as Error & { code?: number }).code = -10;

    const add = jest.fn().mockRejectedValue(duplicateError);
    const queue = { add, getJob: jest.fn().mockResolvedValue(undefined) } as unknown as Queue;

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
    const queue = { add, getJob: jest.fn().mockResolvedValue(undefined) } as unknown as Queue;

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

  it('replaces a completed job with the same id so coordinators can recur', async () => {
    const remove = jest.fn().mockResolvedValue(undefined);
    const getState = jest.fn().mockResolvedValue('completed');
    const add = jest.fn().mockResolvedValue({ id: 'billing.subscription.abc' });
    const queue = {
      add,
      getJob: jest.fn().mockResolvedValue({ getState, remove }),
    } as unknown as Queue;

    await enqueueUnitJob({
      queue,
      jobName: 'billing.subscription.unit',
      payload: { subscriptionId: 'abc' },
      jobIdNamespace: 'billing.subscription',
      jobIdParts: ['abc'],
    });

    expect(remove).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledTimes(1);
  });

  it('replaces a failed job with the same id so coordinators can retry', async () => {
    const remove = jest.fn().mockResolvedValue(undefined);
    const add = jest.fn().mockResolvedValue({ id: 'billing.subscription.abc' });
    const queue = {
      add,
      getJob: jest.fn().mockResolvedValue({
        getState: jest.fn().mockResolvedValue('failed'),
        remove,
      }),
    } as unknown as Queue;

    await enqueueUnitJob({
      queue,
      jobName: 'billing.subscription.unit',
      payload: { subscriptionId: 'abc' },
      jobIdNamespace: 'billing.subscription',
      jobIdParts: ['abc'],
    });

    expect(remove).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledTimes(1);
  });

  it('does not replace an in-flight job with the same id', async () => {
    const remove = jest.fn();
    const add = jest.fn();
    const queue = {
      add,
      getJob: jest.fn().mockResolvedValue({
        getState: jest.fn().mockResolvedValue('active'),
        remove,
      }),
    } as unknown as Queue;

    await expect(
      enqueueUnitJob({
        queue,
        jobName: 'billing.subscription.unit',
        payload: { subscriptionId: 'abc' },
        jobIdNamespace: 'billing.subscription',
        jobIdParts: ['abc'],
      }),
    ).resolves.toBeUndefined();

    expect(remove).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });
});
