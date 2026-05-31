import { registerRepeatableCoordinatorJob, shouldRegisterRepeatableJobs } from '@forepath/shared/backend';
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';

import { CONTROLLER_QUEUE_NAME, getControllerRepeatableJobs } from './job-registry';

@Injectable()
export class ControllerQueueRegistrarService implements OnModuleInit {
  private readonly logger = new Logger(ControllerQueueRegistrarService.name);

  constructor(@InjectQueue(CONTROLLER_QUEUE_NAME) private readonly controllerQueue: Queue) {}

  async onModuleInit(): Promise<void> {
    if (!shouldRegisterRepeatableJobs()) {
      return;
    }

    for (const definition of getControllerRepeatableJobs()) {
      if (definition.disabled) {
        continue;
      }

      await registerRepeatableCoordinatorJob({
        queue: this.controllerQueue,
        name: definition.name,
        coordinatorJobId: definition.coordinatorJobId,
        everyMs: definition.everyMs,
      });
      this.logger.log(`Registered repeatable job ${definition.name} every ${definition.everyMs}ms`);
    }
  }
}
