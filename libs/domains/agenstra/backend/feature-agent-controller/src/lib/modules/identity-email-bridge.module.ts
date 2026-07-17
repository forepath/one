import { IDENTITY_EMAIL_DISPATCHER } from '@forepath/identity/backend';
import { EmailNotificationDispatcherService, INSTANCE_SCOPE_KEY } from '@forepath/shared/backend';
import { Global, Module } from '@nestjs/common';

import { AgenstraNotificationsModule } from './agenstra-notifications.module';

/**
 * Global bridge that wires identity transactional email to the shared
 * EmailNotificationDispatcherService (BullMQ email-deliver jobs).
 */
@Global()
@Module({
  imports: [AgenstraNotificationsModule],
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
export class IdentityEmailBridgeModule {}
