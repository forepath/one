import { assertPatScopes, getUserFromRequest, type RequestWithUser } from '@forepath/identity/backend';
import {
  EmailNotificationDispatcherService,
  IDENTITY_EMAIL_EVENTS,
  IDENTITY_EMAIL_SUBJECTS,
  INSTANCE_SCOPE_KEY,
  NotificationDispatcherService,
  NotificationsModule,
  resolveEmailCompanyFrom,
  resolveEmailCompanyName,
  resolveIdentityEmailTemplateRoots,
} from '@forepath/shared/backend';
import { ForbiddenException, Injectable, Logger, Module } from '@nestjs/common';
import type { ModuleRef } from '@nestjs/core';

import { ProjectAccessService } from '../access/project-access.service';
import { LOADWEAVER_EMAIL_SUBJECTS, resolveLoadweaverEmailTemplateRoots } from './loadweaver-email.constants';
import {
  LOADWEAVER_EMAIL_EVENTS,
  LOADWEAVER_NOTIFICATION_EVENTS,
  LOADWEAVER_QUEUE_NAME,
  type LoadweaverNotificationEvent,
} from './loadweaver-notification.events';

/**
 * Webhook endpoints are managed by Loadweaver cluster admins (3.17: the API key, interactive global admins and
 * members with the cluster-admin role); PATs additionally need `webhooks:admin`.
 */
async function assertNotificationAdmin(req: unknown, moduleRef: ModuleRef): Promise<void> {
  const caller = await moduleRef.get(ProjectAccessService, { strict: false }).caller(req as RequestWithUser);

  if (caller.clusterRole !== 'cluster-admin') throw new ForbiddenException('cluster admin role required');

  assertPatScopes(getUserFromRequest(req as RequestWithUser), 'webhooks:admin');
}

export const loadweaverNotificationsModule = NotificationsModule.register({
  applicationId: 'loadweaver',
  scopeMode: 'instance',
  controllerPath: 'admin/webhooks',
  queueName: LOADWEAVER_QUEUE_NAME,
  eventCatalog: LOADWEAVER_NOTIFICATION_EVENTS,
  resolveScopeKey: () => INSTANCE_SCOPE_KEY,
  assertAdmin: assertNotificationAdmin,
  email: {
    templateRoots: [...resolveLoadweaverEmailTemplateRoots(), ...resolveIdentityEmailTemplateRoots()],
    emailEventCatalog: [...LOADWEAVER_EMAIL_EVENTS, ...IDENTITY_EMAIL_EVENTS],
    subjectRegistry: { ...LOADWEAVER_EMAIL_SUBJECTS, ...IDENTITY_EMAIL_SUBJECTS },
    resolveCompanyName: () => resolveEmailCompanyName(),
    resolveCompanyFrom: () => resolveEmailCompanyFrom(),
  },
});

/** Publishes Loadweaver events to webhook endpoints and emails (the shared notifications feature, 3.18). */
@Injectable()
export class LoadweaverNotificationPublisher {
  private readonly logger = new Logger(LoadweaverNotificationPublisher.name);

  constructor(
    private readonly webhooks: NotificationDispatcherService,
    private readonly emails: EmailNotificationDispatcherService,
  ) {}

  async publish(type: LoadweaverNotificationEvent, data: Record<string, unknown>): Promise<void> {
    await this.webhooks.publish({ type, scopeKey: INSTANCE_SCOPE_KEY, data });
  }

  /** One email per recipient; delivery is queued and retried by the shared feature. */
  async email(
    eventType: (typeof LOADWEAVER_EMAIL_EVENTS)[number],
    templateKey: 'alert-firing' | 'alert-resolved',
    recipients: readonly string[],
    context: Record<string, unknown>,
    correlationId?: string,
  ): Promise<void> {
    for (const to of recipients)
      await this.emails
        .publish({
          eventType,
          scopeKey: INSTANCE_SCOPE_KEY,
          to,
          templateKey,
          templateContext: context,
          ...(correlationId ? { correlationId: `${correlationId}:${to}` } : {}),
        })
        .catch((error: unknown) => this.logger.warn(`Alert email to ${to} not queued: ${String(error)}`));
  }
}

@Module({
  imports: [loadweaverNotificationsModule],
  providers: [LoadweaverNotificationPublisher],
  exports: [LoadweaverNotificationPublisher, loadweaverNotificationsModule],
})
export class LoadweaverNotificationsModule {}
