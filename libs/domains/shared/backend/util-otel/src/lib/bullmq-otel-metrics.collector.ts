import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';

import { OTEL_MODULE_OPTIONS, type OpenTelemetryModuleOptions } from './otel-module.options';
import {
  createOtelBullMqConnection,
  readOtelRedisConnectionConfig,
  type OtelBullMqConnectionHandle,
} from './otel-redis-connection';
import { getMeter } from './otel-sdk';

const JOB_STATES = ['waiting', 'active', 'delayed', 'paused', 'completed', 'failed'] as const;
type JobState = (typeof JOB_STATES)[number];

type QueueJobCounts = Record<JobState, number>;

@Injectable()
export class BullMqOtelMetricsCollector implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BullMqOtelMetricsCollector.name);
  private readonly queueMetrics = new Map<string, QueueJobCounts>();
  private interval: NodeJS.Timeout | undefined;
  private queues: Queue[] = [];
  private connectionHandle: OtelBullMqConnectionHandle | undefined;
  private gaugesRegistered = false;

  constructor(@Inject(OTEL_MODULE_OPTIONS) private readonly options: OpenTelemetryModuleOptions) {}

  onModuleInit(): void {
    const queueNames = this.options.queueNames ?? [];

    if (queueNames.length === 0) {
      return;
    }

    const redis = readOtelRedisConnectionConfig();
    this.connectionHandle = createOtelBullMqConnection(redis);
    const { connection } = this.connectionHandle;
    const prefix = redis.keyPrefix;

    this.queues = queueNames.map(
      (name) =>
        new Queue(name, {
          connection,
          prefix,
        }),
    );

    this.registerGauges();
    void this.pollJobCounts();

    this.interval = setInterval(() => {
      void this.pollJobCounts();
    }, 15_000);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }

    await Promise.all(this.queues.map((queue) => queue.close()));
    this.queues = [];
    await this.connectionHandle?.close();
    this.connectionHandle = undefined;
  }

  private registerGauges(): void {
    if (this.gaugesRegistered) {
      return;
    }

    this.gaugesRegistered = true;
    const meter = getMeter('forepath.bullmq');

    for (const state of JOB_STATES) {
      meter
        .createObservableGauge(`bullmq_queue_jobs_${state}`, {
          description: `BullMQ ${state} jobs per queue`,
        })
        .addCallback((observer) => {
          for (const [queueName, counts] of this.queueMetrics.entries()) {
            observer.observe(counts[state], { queue: queueName });
          }
        });
    }
  }

  private async pollJobCounts(): Promise<void> {
    for (const queue of this.queues) {
      try {
        const counts = await queue.getJobCounts(...JOB_STATES);

        this.queueMetrics.set(queue.name, {
          waiting: counts['waiting'] ?? 0,
          active: counts['active'] ?? 0,
          delayed: counts['delayed'] ?? 0,
          paused: counts['paused'] ?? 0,
          completed: counts['completed'] ?? 0,
          failed: counts['failed'] ?? 0,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown error';

        this.logger.warn(`Failed to poll BullMQ metrics for queue ${queue.name}: ${message}`);
      }
    }
  }
}
