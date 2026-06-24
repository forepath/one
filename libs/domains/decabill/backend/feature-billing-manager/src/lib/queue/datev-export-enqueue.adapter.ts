import { buildJobId, defaultRemoveOnComplete, defaultRemoveOnFail } from '@forepath/shared/backend';
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';

import { DatevExportScope } from '../constants/datev-export.constants';
import { BILLING_QUEUE_NAME, DatevExportJobName } from './billing-queue.constants';
import type { DatevExportEnqueuePort } from './datev-export-enqueue.token';
import type { DatevExportUnitPayload } from './datev-export.payload';

@Injectable()
export class DatevExportEnqueueAdapter implements DatevExportEnqueuePort {
  constructor(@InjectQueue(BILLING_QUEUE_NAME) private readonly billingQueue: Queue) {}

  async enqueueUnit(payload: DatevExportUnitPayload): Promise<void> {
    const monthLabel = String(payload.month).padStart(2, '0');
    const jobIdNamespace = payload.scope === DatevExportScope.UNIFIED ? 'datev-export:unified' : 'datev-export:tenant';
    const jobIdParts =
      payload.scope === DatevExportScope.UNIFIED
        ? [`${payload.year}-${monthLabel}`]
        : [payload.tenantId, `${payload.year}-${monthLabel}`];

    await this.billingQueue.add(DatevExportJobName.UNIT, payload, {
      jobId: buildJobId(jobIdNamespace, ...jobIdParts),
      removeOnComplete: defaultRemoveOnComplete,
      removeOnFail: defaultRemoveOnFail,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });
  }
}
