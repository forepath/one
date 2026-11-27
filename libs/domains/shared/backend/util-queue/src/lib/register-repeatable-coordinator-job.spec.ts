import type { Queue } from 'bullmq';

import { defaultRemoveOnComplete, defaultRemoveOnFail } from './job-retention';
import {
  registerRepeatableCoordinatorJob,
  removeRepeatableCoordinatorJob,
} from './register-repeatable-coordinator-job';

function createQueue(entries: Array<{ key: string; name: string; id?: string | null }> = []) {
  return {
    getJobSchedulers: jest.fn().mockResolvedValue(entries),
    removeRepeatableByKey: jest.fn().mockResolvedValue(true),
    removeJobScheduler: jest.fn().mockResolvedValue(true),
    upsertJobScheduler: jest.fn().mockResolvedValue({}),
    add: jest.fn(),
  };
}

describe('registerRepeatableCoordinatorJob', () => {
  it('removes legacy repeatables of the coordinator before upserting its scheduler', async () => {
    const queue = createQueue([
      { key: '0cc175b9c0f1b6a831c399e269772661', name: 'egress-events-ingest.coordinator' },
      {
        key: 'egress-events-ingest.coordinator:coordinator.egress-events-ingest:::30000',
        name: 'egress-events-ingest.coordinator',
        id: 'coordinator.egress-events-ingest',
      },
      { key: 'coordinator.egress-events-ingest', name: 'egress-events-ingest.coordinator' },
      { key: '92eb5ffee6ae2fec3ad71c777531578f', name: 'other.coordinator' },
    ]);

    await registerRepeatableCoordinatorJob({
      queue: queue as unknown as Queue,
      name: 'egress-events-ingest.coordinator',
      coordinatorJobId: 'coordinator.egress-events-ingest',
      everyMs: 30_000,
    });

    expect(queue.removeRepeatableByKey).toHaveBeenCalledTimes(2);
    expect(queue.removeRepeatableByKey).toHaveBeenCalledWith('0cc175b9c0f1b6a831c399e269772661');
    expect(queue.removeRepeatableByKey).toHaveBeenCalledWith(
      'egress-events-ingest.coordinator:coordinator.egress-events-ingest:::30000',
    );
    expect(queue.removeJobScheduler).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      'coordinator.egress-events-ingest',
      { every: 30_000 },
      {
        name: 'egress-events-ingest.coordinator',
        data: {},
        opts: { removeOnComplete: defaultRemoveOnComplete, removeOnFail: defaultRemoveOnFail },
      },
    );
  });

  it('registers cron pattern with timezone', async () => {
    const queue = createQueue();

    await registerRepeatableCoordinatorJob({
      queue: queue as unknown as Queue,
      name: 'datev-export.coordinator',
      coordinatorJobId: 'coordinator.datev-export',
      pattern: '0 0 1 * *',
      tz: 'Europe/Berlin',
    });

    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      'coordinator.datev-export',
      { pattern: '0 0 1 * *', tz: 'Europe/Berlin' },
      expect.objectContaining({ name: 'datev-export.coordinator' }),
    );
  });

  it('registers cron pattern without timezone', async () => {
    const queue = createQueue();

    await registerRepeatableCoordinatorJob({
      queue: queue as unknown as Queue,
      name: 'datev-export.coordinator',
      coordinatorJobId: 'coordinator.datev-export',
      pattern: '0 0 1 * *',
    });

    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      'coordinator.datev-export',
      { pattern: '0 0 1 * *' },
      expect.objectContaining({ name: 'datev-export.coordinator' }),
    );
  });

  it('passes custom retention to the job template', async () => {
    const queue = createQueue();

    await registerRepeatableCoordinatorJob({
      queue: queue as unknown as Queue,
      name: 'billing.coordinator',
      coordinatorJobId: 'coordinator.billing',
      everyMs: 60_000,
      removeOnComplete: 5,
      removeOnFail: 10,
    });

    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      'coordinator.billing',
      { every: 60_000 },
      expect.objectContaining({ opts: { removeOnComplete: 5, removeOnFail: 10 } }),
    );
  });

  it('throws before touching the queue when neither everyMs nor pattern is configured', async () => {
    const queue = createQueue();

    await expect(
      registerRepeatableCoordinatorJob({
        queue: queue as unknown as Queue,
        name: 'invalid.coordinator',
        coordinatorJobId: 'coordinator.invalid',
      }),
    ).rejects.toThrow('Repeatable job "invalid.coordinator" requires everyMs or pattern');
    expect(queue.getJobSchedulers).not.toHaveBeenCalled();
    expect(queue.upsertJobScheduler).not.toHaveBeenCalled();
  });

  it('only upserts when no legacy repeatables exist', async () => {
    const queue = createQueue([{ key: 'coordinator.billing', name: 'billing.coordinator' }]);

    await registerRepeatableCoordinatorJob({
      queue: queue as unknown as Queue,
      name: 'billing.coordinator',
      coordinatorJobId: 'coordinator.billing',
      everyMs: 60_000,
    });

    expect(queue.removeRepeatableByKey).not.toHaveBeenCalled();
    expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(1);
  });
});

describe('removeRepeatableCoordinatorJob', () => {
  it('removes the scheduler and any legacy repeatable', async () => {
    const queue = createQueue([
      { key: 'coordinator.billing', name: 'billing.coordinator' },
      { key: '0cc175b9c0f1b6a831c399e269772661', name: 'billing.coordinator' },
      { key: '', name: 'billing.coordinator' },
    ]);

    await removeRepeatableCoordinatorJob(queue as unknown as Queue, 'billing.coordinator', 'coordinator.billing');

    expect(queue.removeRepeatableByKey).toHaveBeenCalledTimes(1);
    expect(queue.removeRepeatableByKey).toHaveBeenCalledWith('0cc175b9c0f1b6a831c399e269772661');
    expect(queue.removeJobScheduler).toHaveBeenCalledWith('coordinator.billing');
  });
});
