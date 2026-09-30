import { buildCoordinatorJobId } from '@forepath/shared/backend';
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { Queue } from 'bullmq';

import { OPENCODE_PROVIDERS_REFRESH_JOB_NAME } from '../constants/opencode-providers.constants';
import { AGENSTRA_CONTROLLER_QUEUE_NAME } from '../modules/agenstra-notifications.module';
import { OpencodeProvidersCatalogService } from './opencode-providers-catalog.service';

/**
 * Enqueues an initial catalog refresh when the DB has never been filled.
 */
@Injectable()
export class OpencodeProvidersBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(OpencodeProvidersBootstrapService.name);

  constructor(
    private readonly catalog: OpencodeProvidersCatalogService,
    @Optional() @InjectQueue(AGENSTRA_CONTROLLER_QUEUE_NAME) private readonly controllerQueue?: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.controllerQueue) {
      return;
    }

    try {
      const empty = await this.catalog.isEmpty();
      const emptyModels = !empty && (await this.catalog.hasOnlyEmptyModels());

      if (!empty && !emptyModels) {
        return;
      }

      const reason = empty ? 'bootstrap' : 'bootstrap-empty-models';
      const jobId = buildCoordinatorJobId(
        empty ? 'opencode-providers-refresh-bootstrap' : 'opencode-providers-refresh-empty-models',
      );

      await this.controllerQueue.add(OPENCODE_PROVIDERS_REFRESH_JOB_NAME, { reason }, { jobId });
      this.logger.log(`Enqueued ${OPENCODE_PROVIDERS_REFRESH_JOB_NAME} (${reason})`);
    } catch (error) {
      const err = error as { message?: string };

      this.logger.warn(`Failed to enqueue OpenCode providers bootstrap refresh: ${err.message ?? 'unknown'}`);
    }
  }
}
