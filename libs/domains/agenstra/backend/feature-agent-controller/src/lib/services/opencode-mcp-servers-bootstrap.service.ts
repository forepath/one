import { buildCoordinatorJobId } from '@forepath/shared/backend';
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { Queue } from 'bullmq';

import { OPENCODE_MCP_SERVERS_REFRESH_JOB_NAME } from '../constants/opencode-mcp-servers.constants';
import { AGENSTRA_CONTROLLER_QUEUE_NAME } from '../modules/agenstra-notifications.module';
import { OpencodeMcpServersCatalogService } from './opencode-mcp-servers-catalog.service';

/**
 * Enqueues an initial MCP registry catalog refresh when the DB has never been filled.
 */
@Injectable()
export class OpencodeMcpServersBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(OpencodeMcpServersBootstrapService.name);

  constructor(
    private readonly catalog: OpencodeMcpServersCatalogService,
    @Optional() @InjectQueue(AGENSTRA_CONTROLLER_QUEUE_NAME) private readonly controllerQueue?: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.controllerQueue) {
      return;
    }

    try {
      if (!(await this.catalog.isEmpty())) {
        return;
      }

      const jobId = buildCoordinatorJobId('opencode-mcp-servers-refresh-bootstrap');

      await this.controllerQueue.add(OPENCODE_MCP_SERVERS_REFRESH_JOB_NAME, { reason: 'bootstrap' }, { jobId });
      this.logger.log(`Enqueued ${OPENCODE_MCP_SERVERS_REFRESH_JOB_NAME} (bootstrap)`);
    } catch (error) {
      const err = error as { message?: string };

      this.logger.warn(`Failed to enqueue OpenCode MCP servers bootstrap refresh: ${err.message ?? 'unknown'}`);
    }
  }
}
