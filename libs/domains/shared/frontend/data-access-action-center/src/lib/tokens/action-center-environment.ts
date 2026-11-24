import { InjectionToken } from '@angular/core';
import type { Observable } from 'rxjs';

/**
 * Environment of the shared action center. Consuming applications map it from their environment.
 *
 * @example
 * ```typescript
 * {
 *   provide: ACTION_CENTER_ENVIRONMENT,
 *   useFactory: (env: Environment) => ({
 *     apiUrl: env.billing.urls.restApi,
 *     basePath: 'admin/billing/action-center',
 *     websocketUrl: resolveApiWebsocketUrl(env.billing.urls.websocket, 'action-center'),
 *     socketHeaders: { 'X-Tenant': env.billing.tenantId },
 *     socketAuthExtra: { tenantId: env.billing.tenantId },
 *   }),
 *   deps: [ENVIRONMENT],
 * }
 * ```
 */
export interface ActionCenterEnvironment {
  /** Base REST API URL (no trailing slash). */
  apiUrl: string;
  /** Path of the action center endpoints below `apiUrl` (e.g. `admin/action-center`). */
  basePath: string;
  /** Socket.IO URL including the namespace (e.g. `http://localhost:3100/socket/action-center`). */
  websocketUrl: string;
  /** Extra handshake headers (e.g. `X-Tenant`; only used by transports that can send headers). */
  socketHeaders?: Record<string, string>;
  /** Extra handshake `auth` fields (e.g. `tenantId`), merged into the resolved auth payload. */
  socketAuthExtra?: Record<string, string>;
}

export const ACTION_CENTER_ENVIRONMENT = new InjectionToken<ActionCenterEnvironment>('ActionCenterEnvironment');

/** Socket.IO `auth` payload, or the callback form (re-evaluated on every (re)connect, e.g. for mTLS assertions). */
export type ActionCenterSocketAuth =
  | Record<string, unknown>
  | ((callback: (data: Record<string, unknown>) => void) => void);

/**
 * Resolves the handshake `auth` for the action center socket on every (re)connect, so reconnects always carry the
 * current session token (`null` = not signed in). Provided by the application (it knows its authentication setup);
 * `socketAuthExtra` is merged in by the effects.
 */
export type ActionCenterSocketAuthResolver = () => Observable<ActionCenterSocketAuth | null>;

export const ACTION_CENTER_SOCKET_AUTH = new InjectionToken<ActionCenterSocketAuthResolver>('ActionCenterSocketAuth');
