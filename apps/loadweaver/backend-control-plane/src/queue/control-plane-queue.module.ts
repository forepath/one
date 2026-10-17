import {
  ControlPlaneModule,
  LOADWEAVER_QUEUE_NAME,
  LoadweaverAnnouncementsModule,
  LoadweaverAnnouncementsService,
  LoadweaverNotificationsModule,
  REPORT_COORDINATOR_JOB,
  REPORT_UNIT_JOB,
  ReportsService,
  type ReportUnitPayload,
} from '@forepath/loadweaver/backend/feature-control-plane';
import {
  buildCoordinatorJobId,
  EMAIL_DELIVER_JOB_NAME,
  EmailDeliveryService,
  envCronOrDefault,
  getWebhookDeliveryRetentionCoordinatorIntervalMs,
  registerRepeatableCoordinatorJob,
  resolveEmailDeliverJobPayload,
  resolveWebhookDeliverJobPayload,
  SharedQueueModule,
  shouldRegisterRepeatableJobs,
  shouldRunQueueWorkers,
  UPDATE_CHECK_JOB_NAME,
  WebhookDeliveryRetentionService,
  WebhookDeliveryService,
  WEBHOOK_DELIVER_JOB_NAME,
  WEBHOOK_DELIVERY_RETENTION_COORDINATOR,
  type EmailDeliverJobPayload,
} from '@forepath/shared/backend';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, Module, OnModuleInit } from '@nestjs/common';
import { Job, Queue } from 'bullmq';

/** Notification deliveries (webhooks, email) and their retention (3.18), one queue per member. */
@Processor(LOADWEAVER_QUEUE_NAME, { concurrency: parseInt(process.env.QUEUE_WORKER_CONCURRENCY ?? '5', 10) })
export class ControlPlaneJobsProcessor extends WorkerHost {
  private readonly logger = new Logger(ControlPlaneJobsProcessor.name);

  constructor(
    private readonly webhooks: WebhookDeliveryService,
    private readonly retention: WebhookDeliveryRetentionService,
    private readonly emails: EmailDeliveryService,
    private readonly reports: ReportsService,
    private readonly announcements: LoadweaverAnnouncementsService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case WEBHOOK_DELIVER_JOB_NAME:
        await this.webhooks.deliver(resolveWebhookDeliverJobPayload(job));
        break;
      case EMAIL_DELIVER_JOB_NAME:
        await this.emails.deliver(resolveEmailDeliverJobPayload(job as Job<EmailDeliverJobPayload>));
        break;
      case WEBHOOK_DELIVERY_RETENTION_COORDINATOR:
        await this.retention.applyRetentionForAllEndpoints();
        break;
      // Periodic reports (3.25): the coordinator enqueues one unit per scope and month.
      case REPORT_COORDINATOR_JOB:
        await this.reports.coordinate();
        break;
      case REPORT_UNIT_JOB:
        await this.reports.generate(job.data as ReportUnitPayload);
        break;
      // Release announcements (3.26): the shared update check for the cluster's channel.
      case UPDATE_CHECK_JOB_NAME:
        await this.announcements.run();
        break;
      default:
        this.logger.warn(`Unknown job ${job.name}`);
    }
  }
}

@Injectable()
export class ControlPlaneQueueRegistrar implements OnModuleInit {
  constructor(@InjectQueue(LOADWEAVER_QUEUE_NAME) private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    await registerRepeatableCoordinatorJob({
      queue: this.queue,
      name: WEBHOOK_DELIVERY_RETENTION_COORDINATOR,
      coordinatorJobId: buildCoordinatorJobId('webhook-delivery-retention'),
      everyMs: getWebhookDeliveryRetentionCoordinatorIntervalMs(),
    });
    // Reports for the month that ended, on the 1st (UTC).
    await registerRepeatableCoordinatorJob({
      queue: this.queue,
      name: REPORT_COORDINATOR_JOB,
      coordinatorJobId: buildCoordinatorJobId('reports'),
      pattern: envCronOrDefault('LOADWEAVER_REPORTS_CRON', '0 3 1 * *'),
      tz: 'UTC',
    });

    // Release announcements (3.26), every 6 hours; off for air-gapped clusters.
    if (process.env['LOADWEAVER_UPDATE_CHECK'] !== 'off')
      await registerRepeatableCoordinatorJob({
        queue: this.queue,
        name: UPDATE_CHECK_JOB_NAME,
        coordinatorJobId: buildCoordinatorJobId('update-check'),
        pattern: envCronOrDefault('LOADWEAVER_UPDATE_CHECK_CRON', '17 */6 * * *'),
        tz: 'UTC',
      });
  }
}

@Module({
  imports: [
    SharedQueueModule.forRoot({ queueNames: [LOADWEAVER_QUEUE_NAME] }),
    LoadweaverNotificationsModule,
    ControlPlaneModule,
    // Release announcements through the shared updates feature (3.26).
    LoadweaverAnnouncementsModule,
  ],
  providers: [
    ...(shouldRunQueueWorkers() ? [ControlPlaneJobsProcessor] : []),
    ...(shouldRegisterRepeatableJobs() ? [ControlPlaneQueueRegistrar] : []),
  ],
})
export class ControlPlaneQueueModule {}
