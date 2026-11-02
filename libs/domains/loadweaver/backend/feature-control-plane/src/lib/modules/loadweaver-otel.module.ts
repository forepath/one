import { OpenTelemetryModule } from '@forepath/shared/backend/util-otel';
import { BullMqOtelMetricsCollector } from '@forepath/shared/backend/util-otel/bullmq';
import { Module } from '@nestjs/common';

import { LOADWEAVER_QUEUE_NAME } from '../notifications/loadweaver-notification.events';

export const loadweaverOtelModule = OpenTelemetryModule.register({
  applicationId: 'loadweaver-control-plane',
  // BullMQ job-count gauges (bullmq_queue_jobs_<state>) of the member's queue.
  queueNames: [LOADWEAVER_QUEUE_NAME],
  extraProviders: [BullMqOtelMetricsCollector],
});

@Module({
  imports: [loadweaverOtelModule],
  exports: [loadweaverOtelModule],
})
export class LoadweaverOtelModule {}
