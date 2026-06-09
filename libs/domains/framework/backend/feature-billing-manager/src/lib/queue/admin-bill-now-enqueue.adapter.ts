import { buildJobId, defaultRemoveOnComplete, defaultRemoveOnFail } from '@forepath/shared/backend';
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';

import type { AdminBillNowEnqueuePort } from './admin-bill-now-enqueue.token';
import type { AdminBillNowCoordinatorPayload } from './admin-bill-now.payload';
import { AdminBillNowJobName, BILLING_QUEUE_NAME } from './billing-queue.constants';

@Injectable()
export class AdminBillNowEnqueueAdapter implements AdminBillNowEnqueuePort {
  constructor(@InjectQueue(BILLING_QUEUE_NAME) private readonly billingQueue: Queue) {}

  async enqueueCoordinator(payload: AdminBillNowCoordinatorPayload): Promise<void> {
    await this.billingQueue.add(AdminBillNowJobName.COORDINATOR, payload, {
      jobId: buildJobId('admin-bill-now-request', payload.requestId),
      removeOnComplete: defaultRemoveOnComplete,
      removeOnFail: defaultRemoveOnFail,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });
  }
}
