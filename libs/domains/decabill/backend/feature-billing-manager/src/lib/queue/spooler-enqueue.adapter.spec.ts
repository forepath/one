import { Job, type Queue } from 'bullmq';

import { SpoolerJobName } from './billing-queue.constants';
import { SpoolerEnqueueAdapter } from './spooler-enqueue.adapter';

describe('SpoolerEnqueueAdapter', () => {
  it('adds one deduplicated unit job per spool job with a job id BullMQ accepts', async () => {
    const add = jest.fn();
    const adapter = new SpoolerEnqueueAdapter({ add } as unknown as Queue);

    await adapter.enqueueUnit({ spoolJobId: '3f6c2a1e-4b7d-4c9a-8e2f-1a2b3c4d5e6f', tenantId: 'tenant-a' });

    const [name, data, opts] = add.mock.calls[0];

    expect(name).toBe(SpoolerJobName.UNIT);
    expect(data).toEqual({ spoolJobId: '3f6c2a1e-4b7d-4c9a-8e2f-1a2b3c4d5e6f', tenantId: 'tenant-a' });
    expect(opts).toEqual(expect.objectContaining({ attempts: 3, removeOnComplete: true, removeOnFail: true }));
    // BullMQ's own option validation (ids with ':' must split into exactly three parts).
    const validate = (jobId: string) =>
      (Job.prototype as unknown as { validateOptions(this: unknown, data: unknown): void }).validateOptions.call(
        { opts: { ...opts, jobId } },
        data,
      );

    expect(() => validate(opts.jobId)).not.toThrow();
    expect(() => validate(`spooler:${data.spoolJobId}`)).toThrow('Custom Id cannot contain :');
  });
});
