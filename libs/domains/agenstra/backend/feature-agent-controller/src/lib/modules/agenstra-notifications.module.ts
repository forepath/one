import { INSTANCE_SCOPE_KEY, NotificationsModule } from '@forepath/shared/backend';
import { Module } from '@nestjs/common';

import { AGENSTRA_NOTIFICATION_EVENTS } from '../notifications/agenstra-notification.events';
import { AgenstraNotificationPublisher } from '../notifications/agenstra-notification.publisher';
import { assertNotificationAdmin } from '../notifications/assert-notification-admin.util';

export const AGENSTRA_CONTROLLER_QUEUE_NAME = 'agent-controller';

const notificationsModule = NotificationsModule.register({
  applicationId: 'agenstra',
  scopeMode: 'instance',
  controllerPath: 'admin/webhooks',
  queueName: AGENSTRA_CONTROLLER_QUEUE_NAME,
  eventCatalog: AGENSTRA_NOTIFICATION_EVENTS,
  resolveScopeKey: () => INSTANCE_SCOPE_KEY,
  assertAdmin: assertNotificationAdmin,
});

@Module({
  imports: [notificationsModule],
  providers: [AgenstraNotificationPublisher],
  exports: [AgenstraNotificationPublisher, notificationsModule],
})
export class AgenstraNotificationsModule {}
