import { assertPatScopes, getUserFromRequest, type RequestWithUser } from '@forepath/identity/backend';
import { getTenantIdOrDefault, UpdatesModule } from '@forepath/shared/backend';
import { Module } from '@nestjs/common';

import type { BillingNotificationEventType } from '../notifications/billing-notification.events';
import { BillingNotificationPublisher } from '../notifications/billing-notification.publisher';
import { BILLING_QUEUE_NAME } from '../queue/billing-queue.constants';
import { ensureAdmin } from '../utils/billing-access.utils';

import { BillingIdentityNotificationBridgeModule } from './billing-identity-notification-bridge.module';

let notificationPublisherRef: BillingNotificationPublisher | null = null;

export const billingUpdatesModule = UpdatesModule.register({
  applicationId: 'decabill',
  productScope: 'decabill',
  serviceName: 'billing-manager',
  controllerPath: 'admin/billing/updates',
  queueName: BILLING_QUEUE_NAME,
  resolveScopeKey: () => getTenantIdOrDefault(),
  assertAdmin: (req) => {
    const userInfo = getUserFromRequest(req as RequestWithUser);

    ensureAdmin(userInfo);
    assertPatScopes(userInfo, 'updates:admin');
  },
  publishNotification: (type, data) => {
    notificationPublisherRef?.publish(type as BillingNotificationEventType, data);
  },
});

@Module({
  imports: [BillingIdentityNotificationBridgeModule, billingUpdatesModule],
  providers: [
    {
      provide: 'BILLING_UPDATES_NOTIFICATION_WIRE',
      useFactory: (publisher: BillingNotificationPublisher) => {
        notificationPublisherRef = publisher;

        return true;
      },
      inject: [BillingNotificationPublisher],
    },
  ],
  exports: [billingUpdatesModule],
})
export class BillingUpdatesModule {}
