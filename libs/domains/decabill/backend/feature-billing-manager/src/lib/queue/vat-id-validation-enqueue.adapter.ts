import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';

import { BILLING_QUEUE_NAME, VatIdValidationJobName } from './billing-queue.constants';
import type { VatIdValidationEnqueuePort, VatIdValidationUnitPayload } from './vat-id-validation-enqueue.token';

@Injectable()
export class VatIdValidationEnqueueAdapter implements VatIdValidationEnqueuePort {
  constructor(@InjectQueue(BILLING_QUEUE_NAME) private readonly billingQueue: Queue) {}

  async enqueueUnit(payload: VatIdValidationUnitPayload): Promise<void> {
    await this.billingQueue.add(VatIdValidationJobName.UNIT, payload, {
      jobId: `vat-id-validation:${payload.profileId}:${payload.vatId}`,
      removeOnComplete: true,
      removeOnFail: 50,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
    });
  }
}
