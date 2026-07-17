import { IDENTITY_EMAIL_DISPATCHER } from '@forepath/identity/backend';
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

const emailCompanyFrom = resolveEmailCompanyFrom();

export const billingNotificationsModule = NotificationsModule.register({
  applicationId: 'decabill',
  scopeMode: 'tenant_id',
  controllerPath: 'admin/billing/webhooks',
  queueName: BILLING_QUEUE_NAME,
  eventCatalog: BILLING_NOTIFICATION_EVENTS,
  resolveScopeKey: () => getTenantIdOrDefault(),
  assertAdmin: (req) => ensureAdmin(getUserFromRequest(req as RequestWithUser)),
  email: {
    templateRoots: [...resolveBillingEmailTemplateRoots(), ...resolveIdentityEmailTemplateRoots()],
    emailEventCatalog: [...BILLING_EMAIL_EVENTS, ...IDENTITY_EMAIL_EVENTS],
    subjectRegistry: { ...BILLING_EMAIL_SUBJECTS, ...IDENTITY_EMAIL_SUBJECTS },
    companyName: resolveEmailCompanyName(),
    ...(emailCompanyFrom ? { companyFrom: emailCompanyFrom } : {}),
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
        publishEmail: (input: {
          eventType: string;
          to: string;
          templateKey: string;
          templateContext: Record<string, unknown>;
        }) => {
          dispatcher.publishFireAndForget({
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
