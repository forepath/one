import { IDENTITY_EMAIL_DISPATCHER, type IdentityEmailPublishInput } from '@forepath/identity/backend';
import { EmailNotificationDispatcherService, EmailService, INSTANCE_SCOPE_KEY } from '@forepath/shared/backend';
import { Global, Module } from '@nestjs/common';

import { LoadweaverNotificationsModule } from './loadweaver-notifications.module';

/**
 * Global bridge that wires identity transactional email (signup confirmation, login 2FA codes, password reset) to
 * the shared email dispatcher (queued `email-deliver` jobs). Without it, users-mode logins that require an email
 * code fail with 503 and confirmation emails are dropped.
 *
 * Opts in to "email 2FA only with SMTP" (`isDeliveryConfigured`): while SMTP_HOST / SMTP_PORT are not set in the
 * control-plane environment (e.g. a cluster from `loadweaver-agent bootstrap` without the SMTP flags, or Loadweaver
 * Cloud), email login 2FA is not enforced, because no code could arrive. The console warns cluster admins
 * (`emailLogin2faSuspended` on `GET /api/access/me`).
 */
@Global()
@Module({
  imports: [LoadweaverNotificationsModule],
  providers: [
    {
      provide: IDENTITY_EMAIL_DISPATCHER,
      useFactory: (dispatcher: EmailNotificationDispatcherService, email: EmailService) => ({
        publishEmail: async (input: IdentityEmailPublishInput): Promise<void> => {
          await dispatcher.publish({
            eventType: input.eventType,
            scopeKey: INSTANCE_SCOPE_KEY,
            to: input.to,
            templateKey: input.templateKey,
            templateContext: input.templateContext,
          });
        },
        isDeliveryConfigured: (): boolean => email.isEnabled(),
      }),
      inject: [EmailNotificationDispatcherService, EmailService],
    },
  ],
  exports: [IDENTITY_EMAIL_DISPATCHER],
})
export class LoadweaverIdentityEmailBridgeModule {}
