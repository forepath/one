import { IDENTITY_NOTIFICATION_PUBLISHER } from '@forepath/identity/backend';
import { Global, Module } from '@nestjs/common';

import { AgenstraNotificationPublisher } from '../notifications/agenstra-notification.publisher';

import { AgenstraNotificationsModule } from './agenstra-notifications.module';

/**
 * Global bridge module that wires the identity library's optional
 * `IDENTITY_NOTIFICATION_PUBLISHER` token to `AgenstraNotificationPublisher`.
 *
 * Import this module once in `AppModule`.
 */
@Global()
@Module({
  imports: [AgenstraNotificationsModule],
  providers: [
    {
      provide: IDENTITY_NOTIFICATION_PUBLISHER,
      useExisting: AgenstraNotificationPublisher,
    },
  ],
  exports: [IDENTITY_NOTIFICATION_PUBLISHER],
})
export class IdentityNotificationBridgeModule {}
