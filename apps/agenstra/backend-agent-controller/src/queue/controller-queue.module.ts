import {
  AgenstraNotificationsModule,
  ClientsModule,
  ContextImportModule,
  FilterRulesModule,
} from '@forepath/agenstra/backend/feature-agent-controller';
import { SharedQueueModule, shouldRegisterRepeatableJobs, shouldRunQueueWorkers } from '@forepath/shared/backend';
import { Module, forwardRef } from '@nestjs/common';

import { ControllerQueueRegistrarService } from './controller-queue-registrar.service';
import { CONTROLLER_QUEUE_NAME } from './job-registry';
import { ControllerJobsProcessor } from './processors/controller-jobs.processor';

@Module({
  imports: [
    SharedQueueModule.forRoot({
      queueNames: [CONTROLLER_QUEUE_NAME],
    }),
    AgenstraNotificationsModule,
    forwardRef(() => ClientsModule),
    forwardRef(() => FilterRulesModule),
    forwardRef(() => ContextImportModule),
  ],
  providers: [
    ...(shouldRunQueueWorkers() ? [ControllerJobsProcessor] : []),
    ...(shouldRegisterRepeatableJobs() ? [ControllerQueueRegistrarService] : []),
  ],
})
export class ControllerQueueModule {}
