import {
  FLEET_HEALTH_COORDINATOR_JOB,
  FLEET_HEALTH_POLL_JOB,
  FLEET_OPERATION_STEP_JOB,
} from '@forepath/loadweaver/backend/feature-fleet';
import {
  EMAIL_DELIVER_JOB_NAME,
  WEBHOOK_DELIVER_JOB_NAME,
  WEBHOOK_DELIVERY_RETENTION_COORDINATOR,
} from '@forepath/shared/backend';

import { FleetJobsProcessor, healthPollBucket } from './fleet-queue.module';

// `SharedQueueModule.forRoot` runs at import time and defaults to GLIDE (CACHE_CLIENT=glide): never load the native
// binding or open a client in unit tests.
jest.mock('@valkey/valkey-glide', () => ({ GlideClient: { createClient: jest.fn(() => Promise.resolve({})) } }));
jest.mock('bullmq', () => ({
  ...jest.requireActual('bullmq'),
  createValkeyGlideClient: jest.fn(() => ({ quit: jest.fn().mockResolvedValue('OK') })),
}));

describe('fleet queue', () => {
  it('buckets health polls per minute (idempotent job ids)', () => {
    expect(healthPollBucket(new Date('2026-10-20T12:34:56Z'))).toBe('202610201234');
  });

  it('fans the health coordinator out into one poll per cluster and runs units', async () => {
    const queue = { add: jest.fn(), getJob: jest.fn(async () => undefined) };
    const clusters = { pollableIds: jest.fn(async () => ['a', 'b']), poll: jest.fn() };
    const operations = { coordinate: jest.fn(), runStep: jest.fn() };
    const processor = new FleetJobsProcessor(
      clusters as never,
      operations as never,
      queue as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await processor.process({ name: FLEET_HEALTH_COORDINATOR_JOB, data: {} } as never);
    expect(queue.add).toHaveBeenCalledTimes(2);
    expect(queue.add.mock.calls[0][0]).toBe(FLEET_HEALTH_POLL_JOB);
    expect(queue.add.mock.calls[0][2].jobId).toMatch(/^fleet-health/);

    await processor.process({ name: FLEET_HEALTH_POLL_JOB, data: { clusterId: 'a' } } as never);
    expect(clusters.poll).toHaveBeenCalledWith('a');

    await processor.process({ name: FLEET_OPERATION_STEP_JOB, data: { operationId: 'op' } } as never);
    expect(operations.runStep).toHaveBeenCalledWith('op');
  });

  it('delivers queued notification emails (identity login 2FA codes) and webhooks, and applies retention', async () => {
    const emails = { deliver: jest.fn() };
    const webhooks = { deliver: jest.fn() };
    const retention = { applyRetentionForAllEndpoints: jest.fn() };
    const processor = new FleetJobsProcessor(
      {} as never,
      {} as never,
      {} as never,
      emails as never,
      webhooks as never,
      retention as never,
    );

    await processor.process({
      name: EMAIL_DELIVER_JOB_NAME,
      data: { emailDeliveryId: 'e1' },
      attemptsMade: 0,
      opts: {},
    } as never);
    expect(emails.deliver).toHaveBeenCalledWith(expect.objectContaining({ emailDeliveryId: 'e1', attempt: 1 }));

    await processor.process({
      name: WEBHOOK_DELIVER_JOB_NAME,
      data: { deliveryId: 'w1' },
      attemptsMade: 0,
      opts: {},
    } as never);
    expect(webhooks.deliver).toHaveBeenCalledTimes(1);

    await processor.process({ name: WEBHOOK_DELIVERY_RETENTION_COORDINATOR, data: {} } as never);
    expect(retention.applyRetentionForAllEndpoints).toHaveBeenCalledTimes(1);
  });
});
