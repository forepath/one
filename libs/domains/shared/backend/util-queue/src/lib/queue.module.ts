import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { BullBoardModule } from '@bull-board/nestjs';
import { ExpressAdapter } from '@bull-board/express';
import { BullModule } from '@nestjs/bullmq';
import { DynamicModule, Module } from '@nestjs/common';
import type { QueueOptions } from 'bullmq';

import { createBullBoardAuthMiddlewareFromEnv } from './bull-board-auth';
import { defaultRemoveOnComplete, defaultRemoveOnFail } from './job-retention';
import { shouldEnableBullBoard, shouldRegisterRepeatableJobs, shouldRunQueueWorkers } from './queue-role';
import {
  readBullBoardPath,
  readQueueWorkerConcurrency,
  readRedisConnectionConfig,
  toBullMqConnection,
} from './queue-connection.config';

export const QUEUE_CONNECTION = 'QUEUE_CONNECTION';

export interface SharedQueueModuleOptions {
  /** Queue names to register (processors attach via @Processor in app modules). */
  queueNames: string[];
  /** Default worker concurrency for @Processor classes in this app. */
  workerConcurrency?: number;
}

@Module({})
export class SharedQueueModule {
  static forRoot(options: SharedQueueModuleOptions): DynamicModule {
    const redis = readRedisConnectionConfig();
    const connection = toBullMqConnection(redis);
    const prefix = redis.keyPrefix;
    const concurrency = options.workerConcurrency ?? readQueueWorkerConcurrency();

    const defaultJobOptions: QueueOptions['defaultJobOptions'] = {
      removeOnComplete: defaultRemoveOnComplete,
      removeOnFail: defaultRemoveOnFail,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    };

    const bullImports = [
      BullModule.forRoot({
        connection,
        prefix,
        defaultJobOptions,
      }),
      ...options.queueNames.map((name) =>
        BullModule.registerQueue({
          name,
          connection,
          prefix,
          defaultJobOptions,
        }),
      ),
    ];

    const imports: DynamicModule['imports'] = [...bullImports];
    const moduleExports: DynamicModule['exports'] = [BullModule];

    if (shouldEnableBullBoard() && options.queueNames.length > 0) {
      imports.push(
        BullBoardModule.forRoot({
          route: readBullBoardPath(),
          adapter: ExpressAdapter,
          middleware: createBullBoardAuthMiddlewareFromEnv(),
        }),
        BullBoardModule.forFeature(
          ...options.queueNames.map((name) => ({
            name,
            adapter: BullMQAdapter,
          })),
        ),
      );
    }

    return {
      module: SharedQueueModule,
      imports,
      exports: moduleExports,
      global: true,
      providers: [
        {
          provide: QUEUE_CONNECTION,
          useValue: { connection, prefix, concurrency },
        },
      ],
    };
  }
}

export { shouldRegisterRepeatableJobs, shouldRunQueueWorkers };
