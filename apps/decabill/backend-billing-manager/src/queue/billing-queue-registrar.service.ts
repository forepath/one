import {
  registerRepeatableCoordinatorJob,
  removeRepeatableCoordinatorJob,
  shouldRegisterRepeatableJobs,
  buildCoordinatorJobId,
} from '@forepath/shared/backend';
import { DatevExportJobName } from '@forepath/decabill/backend';
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';

import { BILLING_QUEUE_NAME, getBillingRepeatableJobs } from './job-registry';

function parseBooleanEnv(envKey: string, fallback: boolean): boolean {
  const raw = process.env[envKey];

  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }

  const normalized = raw.trim().toLowerCase();

  if (normalized === 'true' || normalized === '1') {
    return true;
  }

  if (normalized === 'false' || normalized === '0') {
    return false;
  }

  return fallback;
}

@Injectable()
export class BillingQueueRegistrarService implements OnModuleInit {
  private readonly logger = new Logger(BillingQueueRegistrarService.name);

  constructor(@InjectQueue(BILLING_QUEUE_NAME) private readonly billingQueue: Queue) {}

  async onModuleInit(): Promise<void> {
    if (!shouldRegisterRepeatableJobs()) {
      return;
    }

    if (!parseBooleanEnv('BILLING_DATEV_EXPORT_ENABLED', true)) {
      await removeRepeatableCoordinatorJob(
        this.billingQueue,
        DatevExportJobName.COORDINATOR,
        buildCoordinatorJobId('datev-export'),
      );
      this.logger.log('Removed stale DATEV export repeatable job (feature disabled)');
    }

    for (const definition of getBillingRepeatableJobs()) {
      await registerRepeatableCoordinatorJob({
        queue: this.billingQueue,
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
