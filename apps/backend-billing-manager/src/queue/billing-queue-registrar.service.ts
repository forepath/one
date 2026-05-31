import { registerRepeatableCoordinatorJob, shouldRegisterRepeatableJobs } from '@forepath/shared/backend';
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';

import { BILLING_QUEUE_NAME, getBillingRepeatableJobs } from './job-registry';

@Injectable()
export class BillingQueueRegistrarService implements OnModuleInit {
  private readonly logger = new Logger(BillingQueueRegistrarService.name);

  constructor(@InjectQueue(BILLING_QUEUE_NAME) private readonly billingQueue: Queue) {}

  async onModuleInit(): Promise<void> {
    if (!shouldRegisterRepeatableJobs()) {
      return;
    }

    for (const definition of getBillingRepeatableJobs()) {
      await registerRepeatableCoordinatorJob({
        queue: this.billingQueue,
        name: definition.name,
        coordinatorJobId: definition.coordinatorJobId,
        everyMs: definition.everyMs,
      });
      this.logger.log(`Registered repeatable job ${definition.name} every ${definition.everyMs}ms`);
    }
  }
}
