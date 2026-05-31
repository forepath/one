import type { Queue } from 'bullmq';

import { registerRepeatableCoordinatorJob } from './register-repeatable-coordinator-job';

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
      }),
    );
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
    expect(add).toHaveBeenCalledTimes(1);
  });
});
