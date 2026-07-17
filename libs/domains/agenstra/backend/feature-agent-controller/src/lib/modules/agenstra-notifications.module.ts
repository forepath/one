import {
  INSTANCE_SCOPE_KEY,
  IDENTITY_EMAIL_EVENTS,
  IDENTITY_EMAIL_SUBJECTS,
  NotificationsModule,
  resolveEmailCompanyName,
  resolveEmailCompanyFrom,
  resolveIdentityEmailTemplateRoots,
} from '@forepath/shared/backend';
import { Module } from '@nestjs/common';

import { AGENSTRA_NOTIFICATION_EVENTS } from '../notifications/agenstra-notification.events';
import { AgenstraNotificationPublisher } from '../notifications/agenstra-notification.publisher';
import { assertNotificationAdmin } from '../notifications/assert-notification-admin.util';

export const AGENSTRA_CONTROLLER_QUEUE_NAME = 'agent-controller';

const emailCompanyFrom = resolveEmailCompanyFrom();

const notificationsModule = NotificationsModule.register({
  applicationId: 'agenstra',
  scopeMode: 'instance',
  controllerPath: 'admin/webhooks',
  queueName: AGENSTRA_CONTROLLER_QUEUE_NAME,
  eventCatalog: AGENSTRA_NOTIFICATION_EVENTS,
  resolveScopeKey: () => INSTANCE_SCOPE_KEY,
  assertAdmin: assertNotificationAdmin,
  email: {
    templateRoots: resolveIdentityEmailTemplateRoots(),
    emailEventCatalog: IDENTITY_EMAIL_EVENTS,
    subjectRegistry: IDENTITY_EMAIL_SUBJECTS,
    companyName: resolveEmailCompanyName(),
    ...(emailCompanyFrom ? { companyFrom: emailCompanyFrom } : {}),
  },
});

@Module({
  imports: [notificationsModule],
  providers: [AgenstraNotificationPublisher],
  exports: [AgenstraNotificationPublisher, notificationsModule],
})
export class AgenstraNotificationsModule {}
