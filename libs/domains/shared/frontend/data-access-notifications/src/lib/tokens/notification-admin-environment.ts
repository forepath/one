import { InjectionToken } from '@angular/core';

/**
 * Minimal environment interface required by shared notification admin features.
 * Consuming applications provide a value mapped from their full environment.
 */
export interface NotificationAdminEnvironment {
  /** Base REST API URL (no trailing slash). */
  apiUrl: string;
  /** Path segment appended to apiUrl for webhook endpoints (e.g. "admin/webhooks"). */
  webhooksBasePath: string;
  /** Application identifier used for admin scope labeling. */
  applicationId: string;
  /** When true, webhook forms expose an optional client filter field. */
  clientFilterEnabled: boolean;
}

/**
 * Injection token for notification admin environment configuration.
 *
 * @example
 * ```typescript
 * {
 *   provide: NOTIFICATION_ADMIN_ENVIRONMENT,
 *   useFactory: (env: Environment) => ({
 *     apiUrl: env.controller.restApiUrl,
 *     webhooksBasePath: 'admin/webhooks',
 *     applicationId: env.productName,
 *     clientFilterEnabled: true,
 *   }),
 *   deps: [ENVIRONMENT],
 * }
 * ```
 */
export const NOTIFICATION_ADMIN_ENVIRONMENT = new InjectionToken<NotificationAdminEnvironment>(
  'NotificationAdminEnvironment',
);
