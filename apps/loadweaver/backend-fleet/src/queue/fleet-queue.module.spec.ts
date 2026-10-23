import {
  FLEET_HEALTH_COORDINATOR_JOB,
  FLEET_HEALTH_POLL_JOB,
  FLEET_OPERATION_STEP_JOB,
} from '@forepath/loadweaver/backend/feature-fleet';

import { FleetJobsProcessor, healthPollBucket } from './fleet-queue.module';

describe('fleet queue', () => {
  it('buckets health polls per minute (idempotent job ids)', () => {
    expect(healthPollBucket(new Date('2026-10-20T12:34:56Z'))).toBe('202610201234');
  });

  it('fans the health coordinator out into one poll per cluster and runs units', async () => {
    const queue = { add: jest.fn(), getJob: jest.fn(async () => undefined) };
    const clusters = { pollableIds: jest.fn(async () => ['a', 'b']), poll: jest.fn() };
    const operations = { coordinate: jest.fn(), runStep: jest.fn() };
    const processor = new FleetJobsProcessor(clusters as never, operations as never, queue as never);

    await processor.process({ name: FLEET_HEALTH_COORDINATOR_JOB, data: {} } as never);
    expect(queue.add).toHaveBeenCalledTimes(2);
    expect(queue.add.mock.calls[0][0]).toBe(FLEET_HEALTH_POLL_JOB);
    expect(queue.add.mock.calls[0][2].jobId).toMatch(/^fleet-health/);

    await processor.process({ name: FLEET_HEALTH_POLL_JOB, data: { clusterId: 'a' } } as never);
    expect(clusters.poll).toHaveBeenCalledWith('a');

    await processor.process({ name: FLEET_OPERATION_STEP_JOB, data: { operationId: 'op' } } as never);
    expect(operations.runStep).toHaveBeenCalledWith('op');
  });
});
