import { InjectionToken } from '@angular/core';

/**
 * Minimal environment interface required by shared updates admin features.
 * Consuming applications provide a value mapped from their full environment.
 */
export interface UpdatesAdminEnvironment {
  /** Base REST API URL (no trailing slash). */
  apiUrl: string;
  /** Path segment appended to apiUrl for updates endpoints (e.g. "admin/updates"). */
  updatesBasePath: string;
  /** Optional frontend build version shown on the Updates page. */
  frontendVersion?: string;
}

/**
 * Injection token for updates admin environment configuration.
 *
 * @example
 * ```typescript
 * {
 *   provide: UPDATES_ADMIN_ENVIRONMENT,
 *   useFactory: (env: Environment) => ({
 *     apiUrl: env.console.urls.restApi,
 *     updatesBasePath: 'admin/updates',
 *     frontendVersion: env.appVersion,
 *   }),
 *   deps: [ENVIRONMENT],
 * }
 * ```
 */
export const UPDATES_ADMIN_ENVIRONMENT = new InjectionToken<UpdatesAdminEnvironment>('UpdatesAdminEnvironment');
