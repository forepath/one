import {
  registerRepeatableCoordinatorJob,
  removeRepeatableCoordinatorJob,
  shouldRegisterRepeatableJobs,
} from '@forepath/shared/backend';
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';

import { CONTROLLER_QUEUE_NAME, RETIRED_CONTROLLER_REPEATABLE_JOBS, getControllerRepeatableJobs } from './job-registry';

@Injectable()
export class ControllerQueueRegistrarService implements OnModuleInit {
  private readonly logger = new Logger(ControllerQueueRegistrarService.name);

  constructor(@InjectQueue(CONTROLLER_QUEUE_NAME) private readonly controllerQueue: Queue) {}

  async onModuleInit(): Promise<void> {
    if (!shouldRegisterRepeatableJobs()) {
      return;
    }

    for (const retired of RETIRED_CONTROLLER_REPEATABLE_JOBS) {
      await removeRepeatableCoordinatorJob(this.controllerQueue, retired.name, retired.coordinatorJobId);
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
        pattern: definition.pattern,
        tz: definition.tz,
      });
      if (definition.pattern) {
        this.logger.log(`Registered repeatable job ${definition.name} cron ${definition.pattern}`);
      } else {
        this.logger.log(`Registered repeatable job ${definition.name} every ${definition.everyMs}ms`);
      }
    }
  }
}
