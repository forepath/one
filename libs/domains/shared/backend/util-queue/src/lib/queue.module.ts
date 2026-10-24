import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { BullBoardModule } from '@bull-board/nestjs';
import { ExpressAdapter } from '@bull-board/express';
import { BullModule } from '@nestjs/bullmq';
import { DynamicModule, Inject, Injectable, Module, OnApplicationShutdown } from '@nestjs/common';
import type { QueueOptions } from 'bullmq';

import { createBullBoardAuthMiddlewareFromEnv } from './bull-board-auth';
import { createBullMqConnection, type BullMqConnectionHandle } from './queue-client';
import { defaultRemoveOnComplete, defaultRemoveOnFail } from './job-retention';
import { shouldEnableBullBoard, shouldRegisterRepeatableJobs, shouldRunQueueWorkers } from './queue-role';
import { readBullBoardPath, readQueueWorkerConcurrency, readRedisConnectionConfig } from './queue-connection.config';

export const QUEUE_CONNECTION = 'QUEUE_CONNECTION';
const QUEUE_CONNECTION_HANDLE = 'QUEUE_CONNECTION_HANDLE';

/** Closes the shared GLIDE queue client after `@nestjs/bullmq` has shut down queues and workers (imported modules run their hooks first). */
@Injectable()
class QueueConnectionShutdown implements OnApplicationShutdown {
  constructor(@Inject(QUEUE_CONNECTION_HANDLE) private readonly handle: BullMqConnectionHandle) {}

  async onApplicationShutdown(): Promise<void> {
    await this.handle.close();
  }
}

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
    const handle = createBullMqConnection(redis);
    const { connection } = handle;
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
        { provide: QUEUE_CONNECTION_HANDLE, useValue: handle },
        QueueConnectionShutdown,
      ],
    };
  }
}

export { shouldRegisterRepeatableJobs, shouldRunQueueWorkers };
