import { IDENTITY_EMAIL_DISPATCHER, assertPatScopes, type IdentityEmailPublishInput } from '@forepath/identity/backend';
import {
  EmailNotificationDispatcherService,
  getTenantIdOrDefault,
  IDENTITY_EMAIL_EVENTS,
  IDENTITY_EMAIL_SUBJECTS,
  NotificationsModule,
  resolveEmailCompanyName,
  resolveEmailCompanyFrom,
  resolveIdentityEmailTemplateRoots,
} from '@forepath/shared/backend';
import { Global, Module } from '@nestjs/common';

import { BILLING_EMAIL_EVENTS, BILLING_EMAIL_SUBJECTS } from '../email/billing-email-subject.constants';
import { resolveBillingEmailTemplateRoots } from '../email/resolve-billing-email-template-roots';
import { BILLING_NOTIFICATION_EVENTS } from '../notifications/billing-notification.events';
import { BILLING_QUEUE_NAME } from '../queue/billing-queue.constants';
import { ensureAdmin, getUserFromRequest, type RequestWithUser } from '../utils/billing-access.utils';

export const billingNotificationsModule = NotificationsModule.register({
  applicationId: 'decabill',
  scopeMode: 'tenant_id',
  controllerPath: 'admin/billing/webhooks',
  queueName: BILLING_QUEUE_NAME,
  eventCatalog: BILLING_NOTIFICATION_EVENTS,
  resolveScopeKey: () => getTenantIdOrDefault(),
  assertAdmin: (req) => {
    const userInfo = getUserFromRequest(req as RequestWithUser);

    ensureAdmin(userInfo);
    assertPatScopes(userInfo, 'webhooks:admin');
  },
  email: {
    templateRoots: [...resolveBillingEmailTemplateRoots(), ...resolveIdentityEmailTemplateRoots()],
    emailEventCatalog: [...BILLING_EMAIL_EVENTS, ...IDENTITY_EMAIL_EVENTS],
    subjectRegistry: { ...BILLING_EMAIL_SUBJECTS, ...IDENTITY_EMAIL_SUBJECTS },
    resolveCompanyName: () => resolveEmailCompanyName(),
    resolveCompanyFrom: () => resolveEmailCompanyFrom(),
  },
});

/**
 * Global bridge so BillingUsersAuthModule can inject IDENTITY_EMAIL_DISPATCHER.
 */
@Global()
@Module({
  imports: [billingNotificationsModule],
  providers: [
    {
      provide: IDENTITY_EMAIL_DISPATCHER,
      useFactory: (dispatcher: EmailNotificationDispatcherService) => ({
        publishEmail: async (input: IdentityEmailPublishInput): Promise<void> => {
          await dispatcher.publish({
            eventType: input.eventType,
            scopeKey: getTenantIdOrDefault(),
            to: input.to,
            templateKey: input.templateKey,
            templateContext: input.templateContext,
          });
        },
      }),
      inject: [EmailNotificationDispatcherService],
    },
  ],
  exports: [IDENTITY_EMAIL_DISPATCHER, billingNotificationsModule],
})
export class BillingIdentityEmailBridgeModule {}
