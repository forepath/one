import { CanActivateFn, Route } from '@angular/router';
import {
  AdminWebhooksFacade,
  adminWebhooksReducer,
  createAdminWebhook$,
  deleteAdminWebhook$,
  loadAdminWebhookDeliveries$,
  loadAdminWebhookDeliveriesBatch$,
  loadAdminWebhookEventTypes$,
  loadAdminWebhooks$,
  loadAdminWebhooksBatch$,
  testAdminWebhook$,
  updateAdminWebhook$,
} from '@forepath/shared/frontend/data-access-notifications';
import { buildPageTitle } from '@forepath/shared/frontend/util-configuration';
import { provideEffects } from '@ngrx/effects';
import { provideState } from '@ngrx/store';

import { WebhookManagerComponent } from './webhook-manager/webhook-manager.component';

/**
 * Notification admin routes for use in consuming applications.
 *
 * The consuming application must provide:
 * - `NOTIFICATION_ADMIN_ENVIRONMENT` token with `NotificationAdminEnvironment` value
 * - Optional `NOTIFICATION_ADMIN_CLIENT_PROVIDER` when client filtering is enabled
 *
 * @example
 * ```typescript
 * import { createNotificationAdminRoutes, notificationAdminProviders } from '@forepath/shared/frontend/feature-notifications';
 *
 * const appRoutes: Route[] = [
 *   {
 *     path: '',
 *     children: [
 *       ...createNotificationAdminRoutes([authGuard, adminGuard]),
 *     ],
 *     providers: [
 *       ...notificationAdminProviders,
 *     ],
 *   },
 * ];
 * ```
 */
export function createNotificationAdminRoutes(canActivate: CanActivateFn[], path = 'webhooks'): Route[] {
  return [
    {
      path,
      canActivate,
      component: WebhookManagerComponent,
      title: () => buildPageTitle($localize`:@@featureNotifications-webhooksPage:Webhooks`),
    },
  ];
}

/**
 * NgRx providers for shared notification admin state.
 */
export const notificationAdminProviders = [
  AdminWebhooksFacade,
  provideState('adminWebhooks', adminWebhooksReducer),
  provideEffects({
    loadAdminWebhooks$,
    loadAdminWebhooksBatch$,
    loadAdminWebhookEventTypes$,
    createAdminWebhook$,
    updateAdminWebhook$,
    deleteAdminWebhook$,
    testAdminWebhook$,
    loadAdminWebhookDeliveries$,
    loadAdminWebhookDeliveriesBatch$,
  }),
];

export {
  watchNotificationMutationModalClose,
  showNotificationModal,
  hideNotificationModal,
} from './notification-modal';
