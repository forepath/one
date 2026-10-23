import { IDENTITY_EMAIL_DISPATCHER, type IdentityEmailPublishInput } from '@forepath/identity/backend';
import { EmailNotificationDispatcherService, INSTANCE_SCOPE_KEY } from '@forepath/shared/backend';
import { Global, Module } from '@nestjs/common';

import { LoadweaverNotificationsModule } from './loadweaver-notifications.module';

/**
 * Global bridge that wires identity transactional email (signup confirmation, login 2FA codes, password reset) to
 * the shared email dispatcher (queued `email-deliver` jobs). Without it, users-mode logins that require an email
 * code fail with 503 and confirmation emails are dropped.
 */
@Global()
@Module({
  imports: [LoadweaverNotificationsModule],
  providers: [
    {
      provide: IDENTITY_EMAIL_DISPATCHER,
      useFactory: (dispatcher: EmailNotificationDispatcherService) => ({
        publishEmail: async (input: IdentityEmailPublishInput): Promise<void> => {
          await dispatcher.publish({
            eventType: input.eventType,
            scopeKey: INSTANCE_SCOPE_KEY,
            to: input.to,
            templateKey: input.templateKey,
            templateContext: input.templateContext,
          });
        },
      }),
      inject: [EmailNotificationDispatcherService],
    },
  ],
  exports: [IDENTITY_EMAIL_DISPATCHER],
})
export class LoadweaverIdentityEmailBridgeModule {}
