import { BillingModule } from '@forepath/decabill/backend';
import { SharedQueueModule, shouldRegisterRepeatableJobs, shouldRunQueueWorkers } from '@forepath/shared/backend';
import { Module } from '@nestjs/common';

import { BillingQueueRegistrarService } from './billing-queue-registrar.service';
import { BILLING_QUEUE_NAME } from './job-registry';
import { BillingJobsProcessor } from './processors/billing-jobs.processor';

@Module({
  imports: [
    SharedQueueModule.forRoot({
      queueNames: [BILLING_QUEUE_NAME],
    }),
    BillingModule,
  ],
  providers: [
    ...(shouldRunQueueWorkers() ? [BillingJobsProcessor] : []),
    ...(shouldRegisterRepeatableJobs() ? [BillingQueueRegistrarService] : []),
  ],
})
export class BillingQueueModule {}
