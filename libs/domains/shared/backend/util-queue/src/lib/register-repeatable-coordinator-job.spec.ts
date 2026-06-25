import type { Queue } from 'bullmq';

import { defaultRemoveOnComplete, defaultRemoveOnFail } from './job-retention';
import {
  registerRepeatableCoordinatorJob,
  removeRepeatableCoordinatorJob,
} from './register-repeatable-coordinator-job';

describe('registerRepeatableCoordinatorJob', () => {
  it('removes stale repeatables before registering', async () => {
    const removeRepeatableByKey = jest.fn().mockResolvedValue(true);
    const add = jest.fn().mockResolvedValue({ id: 'coordinator.filter-rules-sync' });
    const queue = {
      getRepeatableJobs: jest.fn().mockResolvedValue([
        { name: 'filter-rules-sync.coordinator', id: 'coordinator.filter-rules-sync', key: 'repeat:abc' },
        { name: 'other.coordinator', id: 'coordinator.other', key: 'repeat:def' },
      ]),
      removeRepeatableByKey,
      add,
    } as unknown as Queue;

    await registerRepeatableCoordinatorJob({
      queue,
      name: 'filter-rules-sync.coordinator',
      coordinatorJobId: 'coordinator.filter-rules-sync',
      everyMs: 30_000,
    });

    expect(removeRepeatableByKey).toHaveBeenCalledTimes(1);
    expect(removeRepeatableByKey).toHaveBeenCalledWith('repeat:abc');
    expect(add).toHaveBeenCalledWith(
      'filter-rules-sync.coordinator',
      {},
      expect.objectContaining({
        jobId: 'coordinator.filter-rules-sync',
        repeat: { every: 30_000 },
        removeOnComplete: defaultRemoveOnComplete,
        removeOnFail: defaultRemoveOnFail,
      }),
    );
  });

  it('registers cron pattern with timezone', async () => {
    const add = jest.fn().mockResolvedValue({ id: 'coordinator.datev-export' });
    const queue = {
      getRepeatableJobs: jest.fn().mockResolvedValue([]),
      removeRepeatableByKey: jest.fn(),
      add,
    } as unknown as Queue;

    await registerRepeatableCoordinatorJob({
      queue,
      name: 'datev-export.coordinator',
      coordinatorJobId: 'coordinator.datev-export',
      pattern: '0 0 1 * *',
      tz: 'Europe/Berlin',
    });

    expect(add).toHaveBeenCalledWith(
      'datev-export.coordinator',
      {},
      expect.objectContaining({
        repeat: { pattern: '0 0 1 * *', tz: 'Europe/Berlin' },
      }),
    );
  });

  it('registers cron pattern without timezone', async () => {
    const add = jest.fn().mockResolvedValue({ id: 'coordinator.datev-export' });
    const queue = {
      getRepeatableJobs: jest.fn().mockResolvedValue([]),
      removeRepeatableByKey: jest.fn(),
      add,
    } as unknown as Queue;

    await registerRepeatableCoordinatorJob({
      queue,
      name: 'datev-export.coordinator',
      coordinatorJobId: 'coordinator.datev-export',
      pattern: '0 0 1 * *',
    });

    expect(add).toHaveBeenCalledWith(
      'datev-export.coordinator',
      {},
      expect.objectContaining({
        repeat: { pattern: '0 0 1 * *' },
      }),
    );
  });

  it('throws when neither everyMs nor pattern is configured', async () => {
    const queue = {
      getRepeatableJobs: jest.fn().mockResolvedValue([]),
      removeRepeatableByKey: jest.fn(),
      add: jest.fn(),
    } as unknown as Queue;

    await expect(
      registerRepeatableCoordinatorJob({
        queue,
        name: 'invalid.coordinator',
        coordinatorJobId: 'coordinator.invalid',
      }),
    ).rejects.toThrow('Repeatable job "invalid.coordinator" requires everyMs or pattern');
  });

  it('registers when no stale repeatables exist', async () => {
    const add = jest.fn().mockResolvedValue({ id: 'coordinator.billing' });
    const queue = {
      getRepeatableJobs: jest.fn().mockResolvedValue([]),
      removeRepeatableByKey: jest.fn(),
      add,
    } as unknown as Queue;

    await registerRepeatableCoordinatorJob({
      queue,
      name: 'billing.coordinator',
      coordinatorJobId: 'coordinator.billing',
      everyMs: 60_000,
    });

    expect(queue.removeRepeatableByKey).not.toHaveBeenCalled();
    expect(add).toHaveBeenCalledWith(
      'billing.coordinator',
      {},
      expect.objectContaining({
        removeOnComplete: defaultRemoveOnComplete,
        removeOnFail: defaultRemoveOnFail,
      }),
    );
  });
});

describe('removeRepeatableCoordinatorJob', () => {
  it('skips stale repeatables without a key', async () => {
    const removeRepeatableByKey = jest.fn();
    const queue = {
      getRepeatableJobs: jest.fn().mockResolvedValue([
        { name: 'billing.coordinator', id: 'coordinator.billing' },
        { name: 'billing.coordinator', id: 'coordinator.billing', key: 'repeat:abc' },
      ]),
      removeRepeatableByKey,
    } as unknown as Queue;

    await removeRepeatableCoordinatorJob(queue, 'billing.coordinator', 'coordinator.billing');

    expect(removeRepeatableByKey).toHaveBeenCalledTimes(1);
    expect(removeRepeatableByKey).toHaveBeenCalledWith('repeat:abc');
  });
});
