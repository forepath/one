import { ClientEntity } from '@forepath/identity/backend';
import { INSTANCE_SCOPE_KEY, UpdatesModule } from '@forepath/shared/backend';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import type { AgenstraNotificationEventType } from '../notifications/agenstra-notification.events';
import { AgenstraNotificationPublisher } from '../notifications/agenstra-notification.publisher';
import { assertUpdatesAdmin } from '../notifications/assert-updates-admin.util';
import { ClientsRepository } from '../repositories/clients.repository';
import { AgentManagerInstanceScrapeService } from '../services/agent-manager-instance-scrape.service';

import { AGENSTRA_CONTROLLER_QUEUE_NAME, AgenstraNotificationsModule } from './agenstra-notifications.module';

let notificationPublisherRef: AgenstraNotificationPublisher | null = null;
let instanceScrapeRef: AgentManagerInstanceScrapeService | null = null;
const updatesModule = UpdatesModule.register({
  applicationId: 'agenstra',
  productScope: 'agenstra',
  serviceName: 'agent-controller',
  controllerPath: 'admin/updates',
  queueName: AGENSTRA_CONTROLLER_QUEUE_NAME,
  resolveScopeKey: () => INSTANCE_SCOPE_KEY,
  assertAdmin: assertUpdatesAdmin,
  publishNotification: (type, data) => {
    notificationPublisherRef?.publish(type as AgenstraNotificationEventType, data);
  },
  refreshRemoteInstances: async () => {
    await instanceScrapeRef?.refreshRemoteInstances();
  },
});

@Module({
  imports: [TypeOrmModule.forFeature([ClientEntity]), AgenstraNotificationsModule, updatesModule],
  providers: [
    ClientsRepository,
    AgentManagerInstanceScrapeService,
    {
      provide: 'UPDATES_NOTIFICATION_WIRE',
      useFactory: (publisher: AgenstraNotificationPublisher, scrapeService: AgentManagerInstanceScrapeService) => {
        notificationPublisherRef = publisher;
        instanceScrapeRef = scrapeService;

        return true;
      },
      inject: [AgenstraNotificationPublisher, AgentManagerInstanceScrapeService],
    },
  ],
  exports: [updatesModule, AgentManagerInstanceScrapeService],
})
export class AgenstraUpdatesModule {}
