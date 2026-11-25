import { buildJobId } from '@forepath/shared/backend';
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';

import type { SpoolerEnqueuePort, SpoolerUnitPayload } from '../spooler/spooler-enqueue.token';
import { SPOOL_JOB_BACKOFF_MS, SPOOL_JOB_MAX_ATTEMPTS } from '../spooler/spooler.constants';

import { BILLING_QUEUE_NAME, SpoolerJobName } from './billing-queue.constants';

@Injectable()
export class SpoolerEnqueueAdapter implements SpoolerEnqueuePort {
  constructor(@InjectQueue(BILLING_QUEUE_NAME) private readonly billingQueue: Queue) {}

  /** One queue entry per spool job (`jobId` de-duplicates re-enqueues while the entry exists). */
  async enqueueUnit(payload: SpoolerUnitPayload): Promise<void> {
    await this.billingQueue.add(SpoolerJobName.UNIT, payload, {
      jobId: buildJobId('spooler', payload.spoolJobId),
      removeOnComplete: true,
      removeOnFail: true,
      attempts: SPOOL_JOB_MAX_ATTEMPTS,
      backoff: { type: 'exponential', delay: SPOOL_JOB_BACKOFF_MS },
    });
  }
}
