import { OpenSearchModule, OpenSearchService } from '@forepath/shared/backend/util-opensearch';
import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { DynamicModule, Module, Provider } from '@nestjs/common';
import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';


import { UPDATES_MODULE_OPTIONS } from './constants/updates.constants';
import { createUpdatesController } from './controllers/updates.controller';
import type { UpdatesModuleOptions } from './interfaces/updates-module.options';
import { GitHubReleasesClient } from './services/github-releases.client';
import { InstanceHeartbeatService } from './services/instance-heartbeat.service';
import { UpdateCheckService } from './services/update-check.service';
import { UpdatesMetricsCollector } from './services/updates-metrics.collector';
import { UpdatesQueryService } from './services/updates-query.service';
import { UpdatesRedisStore } from './services/updates-redis.store';

@Module({})
export class UpdatesModule {
  static register(options: UpdatesModuleOptions): DynamicModule {
    const optionsProvider: Provider = {
      provide: UPDATES_MODULE_OPTIONS,
      useValue: options,
    };

    return {
      module: UpdatesModule,
      imports: [BullModule.registerQueue({ name: options.queueName }), OpenSearchModule],
      controllers: [createUpdatesController(options.controllerPath)],
      providers: [
        optionsProvider,
        UpdatesRedisStore,
        GitHubReleasesClient,
        UpdatesQueryService,
        UpdatesMetricsCollector,
        {
          provide: UpdateCheckService,
          useFactory: (
            store: UpdatesRedisStore,
            githubClient: GitHubReleasesClient,
            moduleOptions: UpdatesModuleOptions,
            queue: Queue,
          ) => new UpdateCheckService(store, githubClient, moduleOptions, queue),
          inject: [UpdatesRedisStore, GitHubReleasesClient, UPDATES_MODULE_OPTIONS, getQueueToken(options.queueName)],
        },
        {
          provide: InstanceHeartbeatService,
          useFactory: (
            store: UpdatesRedisStore,
            moduleOptions: UpdatesModuleOptions,
            queue: Queue,
            dataSource?: DataSource,
            openSearch?: OpenSearchService,
          ) => new InstanceHeartbeatService(store, moduleOptions, queue, dataSource ?? null, openSearch ?? null),
          inject: [
            UpdatesRedisStore,
            UPDATES_MODULE_OPTIONS,
            getQueueToken(options.queueName),
            { token: DataSource, optional: true },
            { token: OpenSearchService, optional: true },
          ],
        },
      ],
      exports: [
        UpdateCheckService,
        UpdatesQueryService,
        InstanceHeartbeatService,
        UpdatesRedisStore,
        UPDATES_MODULE_OPTIONS,
      ],
    };
  }
}
