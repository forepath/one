import {
  FLEET_HEALTH_COORDINATOR_JOB,
  FLEET_HEALTH_POLL_JOB,
  FLEET_OPERATION_STEP_JOB,
  FLEET_OPERATIONS_COORDINATOR_JOB,
  FLEET_QUEUE_NAME,
  FleetClustersService,
  FleetModule,
  FleetNotificationsModule,
  FleetOperationsService,
} from '@forepath/loadweaver/backend/feature-fleet';
import {
  buildCoordinatorJobId,
  EMAIL_DELIVER_JOB_NAME,
  EmailDeliveryService,
  enqueueUnitJob,
  envCronOrDefault,
  getWebhookDeliveryRetentionCoordinatorIntervalMs,
  registerRepeatableCoordinatorJob,
  resolveEmailDeliverJobPayload,
  resolveWebhookDeliverJobPayload,
  SharedQueueModule,
  shouldRegisterRepeatableJobs,
  shouldRunQueueWorkers,
  WebhookDeliveryRetentionService,
  WebhookDeliveryService,
  WEBHOOK_DELIVER_JOB_NAME,
  WEBHOOK_DELIVERY_RETENTION_COORDINATOR,
  type EmailDeliverJobPayload,
} from '@forepath/shared/backend';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, Module, OnModuleInit } from '@nestjs/common';
import { Job, Queue } from 'bullmq';

/** Minute bucket of a health poll: at most one poll per cluster and minute, whatever the coordinators do. */
export function healthPollBucket(now = new Date()): string {
  return now.toISOString().slice(0, 16).replace(/[-:T]/g, '');
}

/**
 * Health polls (coordinator → one unit per cluster), cross-cluster operation steps and the shared notification
 * deliveries (identity emails such as login 2FA codes, webhooks) with their retention.
 */
@Processor(FLEET_QUEUE_NAME, { concurrency: parseInt(process.env.QUEUE_WORKER_CONCURRENCY ?? '5', 10) })
export class FleetJobsProcessor extends WorkerHost {
  private readonly logger = new Logger(FleetJobsProcessor.name);

  constructor(
    private readonly clusters: FleetClustersService,
    private readonly operations: FleetOperationsService,
    @InjectQueue(FLEET_QUEUE_NAME) private readonly queue: Queue,
    private readonly emails: EmailDeliveryService,
    private readonly webhooks: WebhookDeliveryService,
    private readonly retention: WebhookDeliveryRetentionService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case FLEET_HEALTH_COORDINATOR_JOB: {
        const bucket = healthPollBucket();

        for (const id of await this.clusters.pollableIds())
          await enqueueUnitJob({
            queue: this.queue,
            jobName: FLEET_HEALTH_POLL_JOB,
            payload: { clusterId: id },
            jobIdNamespace: 'fleet-health',
            jobIdParts: [id, bucket],
            opts: { attempts: 1 },
          });
        break;
      }
      case FLEET_HEALTH_POLL_JOB:
        await this.clusters.poll((job.data as { clusterId: string }).clusterId);
        break;
      case FLEET_OPERATIONS_COORDINATOR_JOB:
        await this.operations.coordinate();
        break;
      case FLEET_OPERATION_STEP_JOB:
        await this.operations.runStep((job.data as { operationId: string }).operationId);
        break;
      case EMAIL_DELIVER_JOB_NAME:
        await this.emails.deliver(resolveEmailDeliverJobPayload(job as Job<EmailDeliverJobPayload>));
        break;
      case WEBHOOK_DELIVER_JOB_NAME:
        await this.webhooks.deliver(resolveWebhookDeliverJobPayload(job));
        break;
      case WEBHOOK_DELIVERY_RETENTION_COORDINATOR:
        await this.retention.applyRetentionForAllEndpoints();
        break;
      default:
        this.logger.warn(`Unknown job ${job.name}`);
    }
  }
}

@Injectable()
export class FleetQueueRegistrar implements OnModuleInit {
  constructor(@InjectQueue(FLEET_QUEUE_NAME) private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    await registerRepeatableCoordinatorJob({
      queue: this.queue,
      name: FLEET_HEALTH_COORDINATOR_JOB,
      coordinatorJobId: buildCoordinatorJobId('fleet-health'),
      pattern: envCronOrDefault('FLEET_HEALTH_POLL_CRON', '* * * * *'),
      tz: 'UTC',
    });
    await registerRepeatableCoordinatorJob({
      queue: this.queue,
      name: FLEET_OPERATIONS_COORDINATOR_JOB,
      coordinatorJobId: buildCoordinatorJobId('fleet-operations'),
      pattern: envCronOrDefault('FLEET_OPERATIONS_CRON', '* * * * *'),
      tz: 'UTC',
    });
    await registerRepeatableCoordinatorJob({
      queue: this.queue,
      name: WEBHOOK_DELIVERY_RETENTION_COORDINATOR,
      coordinatorJobId: buildCoordinatorJobId('webhook-delivery-retention'),
      everyMs: getWebhookDeliveryRetentionCoordinatorIntervalMs(),
    });
  }
}

@Module({
  imports: [SharedQueueModule.forRoot({ queueNames: [FLEET_QUEUE_NAME] }), FleetModule, FleetNotificationsModule],
  providers: [
    ...(shouldRunQueueWorkers() ? [FleetJobsProcessor] : []),
    ...(shouldRegisterRepeatableJobs() ? [FleetQueueRegistrar] : []),
  ],
})
export class FleetQueueModule {}
