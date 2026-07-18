import { IDENTITY_NOTIFICATION_PUBLISHER } from '@forepath/identity/backend';
import { Global, Module } from '@nestjs/common';

import { BillingNotificationPublisher } from '../notifications/billing-notification.publisher';

import { BillingIdentityEmailBridgeModule } from './billing-identity-email-bridge.module';

/**
 * Global bridge module that wires the identity library's optional
 * `IDENTITY_NOTIFICATION_PUBLISHER` token to `BillingNotificationPublisher`.
 *
 * Import this module once in `AppModule`.
 */
@Global()
@Module({
  imports: [BillingIdentityEmailBridgeModule],
  providers: [
    BillingNotificationPublisher,
    {
      provide: IDENTITY_NOTIFICATION_PUBLISHER,
      useExisting: BillingNotificationPublisher,
    },
  ],
  exports: [IDENTITY_NOTIFICATION_PUBLISHER, BillingNotificationPublisher],
})
export class BillingIdentityNotificationBridgeModule {}
