import { shouldRegisterRepeatableJobs } from '@forepath/shared/backend';
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

      await this.controllerQueue.add(
        definition.name,
        {},
        {
          jobId: definition.coordinatorJobId,
          repeat: { every: definition.everyMs },
          removeOnComplete: true,
          removeOnFail: 100,
        },
      );
      this.logger.log(`Registered repeatable job ${definition.name} every ${definition.everyMs}ms`);
    }
  }
}
