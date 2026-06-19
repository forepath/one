import { inject } from '@angular/core';
import type { Environment } from '@forepath/shared/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { KeycloakService } from 'keycloak-angular';
import type { Observable } from 'rxjs';
import { catchError, filter, from, fromEvent, map, merge, mergeMap, of, switchMap, take, takeUntil, tap } from 'rxjs';
import { io, Socket } from 'socket.io-client';

import type { BillingDashboardStatusUpdatePayload } from '../../types/billing.types';
import {
  billingDashboardStatusPush,
  loadOverviewServerInfo,
} from '../subscription-server-info/subscription-server-info.actions';

import {
  billingDashboardSocketApplicationError,
  billingDashboardSocketDataReceived,
  connectBillingDashboardSocket,
  connectBillingDashboardSocketFailure,
  connectBillingDashboardSocketSuccess,
  disconnectBillingDashboardSocket,
  disconnectBillingDashboardSocketSuccess,
} from './billing-dashboard-socket.actions';
import { resolveBillingTenantId } from '../../interceptors/tenant.interceptor';

const API_KEY_STORAGE_KEY = 'agent-controller-api-key';
const USERS_JWT_STORAGE_KEY = 'agent-controller-users-jwt';

function getAuthHeader(environment: Environment, keycloakService: KeycloakService | null): Observable<string | null> {
  if (environment.authentication.type === 'api-key') {
    const apiKey =
      environment.authentication.apiKey ??
      (typeof localStorage !== 'undefined' ? localStorage.getItem(API_KEY_STORAGE_KEY) : null);

    if (apiKey) {
      return of(`Bearer ${apiKey}`);
    }

    return of(null);
  }

  if (environment.authentication.type === 'keycloak' && keycloakService) {
    return from(keycloakService.getToken()).pipe(
      map((token) => (token ? `Bearer ${token}` : null)),
      catchError(() => of(null)),
    );
  }

  if (environment.authentication.type === 'users') {
    const jwt = typeof localStorage !== 'undefined' ? localStorage.getItem(USERS_JWT_STORAGE_KEY) : null;

    if (jwt) {
      return of(`Bearer ${jwt}`);
    }

    return of(null);
  }

  return of(null);
}

let billingDashboardSocketInstance: Socket | null = null;

export function getBillingDashboardSocketInstance(): Socket | null {
  return billingDashboardSocketInstance;
}

export const connectBillingDashboardSocket$ = createEffect(
  (
    actions$ = inject(Actions),
    environment = inject<Environment>(ENVIRONMENT),
    keycloakService = inject(KeycloakService, { optional: true }),
  ) => {
    return actions$.pipe(
      ofType(connectBillingDashboardSocket),
      switchMap(() => {
        const websocketUrl = environment.billing.websocketUrl?.trim();

        if (!websocketUrl) {
          return of(connectBillingDashboardSocketFailure({ error: 'Billing WebSocket URL not configured' }));
        }

        if (billingDashboardSocketInstance) {
          billingDashboardSocketInstance.disconnect();
          billingDashboardSocketInstance = null;
        }

        return getAuthHeader(environment, keycloakService).pipe(
          switchMap((authHeader) => {
            if (!authHeader) {
              return of(connectBillingDashboardSocketFailure({ error: 'Not authenticated for WebSocket' }));
            }

            billingDashboardSocketInstance = io(websocketUrl, {
              transports: ['websocket'],
              rejectUnauthorized: false,
              reconnection: true,
              reconnectionAttempts: 5,
              reconnectionDelay: 1000,
              reconnectionDelayMax: 5000,
              randomizationFactor: 0.5,
              extraHeaders: {
                'X-Tenant': resolveBillingTenantId(environment),
              },
              auth: {
                Authorization: authHeader,
                tenantId: resolveBillingTenantId(environment),
              },
            });

            const socket = billingDashboardSocketInstance;

            socket.on('connect', () => {
              socket.emit('subscribeDashboardStatus', {});
            });

            const connectSuccess$ = fromEvent(socket, 'connect').pipe(
              take(1),
              map(() => connectBillingDashboardSocketSuccess()),
            );
            const connectError$ = fromEvent<Error>(socket, 'connect_error').pipe(
              takeUntil(fromEvent(socket, 'connect')),
              take(1),
              map(() => connectBillingDashboardSocketFailure({ error: 'WebSocket connection failed' })),
            );
            const statusUpdate$ = fromEvent<BillingDashboardStatusUpdatePayload>(socket, 'dashboardStatusUpdate').pipe(
              mergeMap((payload) => from([billingDashboardStatusPush(payload), billingDashboardSocketDataReceived()])),
            );
            const appError$ = fromEvent<{ message: string }>(socket, 'error').pipe(
              map((data) => billingDashboardSocketApplicationError({ message: data.message ?? 'Socket error' })),
            );

            return merge(connectSuccess$, connectError$, statusUpdate$, appError$).pipe(
              catchError((error: unknown) => {
                billingDashboardSocketInstance = null;
                const message = error instanceof Error ? error.message : 'WebSocket error';

                return of(connectBillingDashboardSocketFailure({ error: message }));
              }),
            );
          }),
          catchError(() => of(connectBillingDashboardSocketFailure({ error: 'WebSocket setup failed' }))),
        );
      }),
    );
  },
  { functional: true },
);

export const disconnectBillingDashboardSocket$ = createEffect(
  (actions$ = inject(Actions)) => {
    return actions$.pipe(
      ofType(disconnectBillingDashboardSocket),
      tap(() => {
        if (billingDashboardSocketInstance) {
          billingDashboardSocketInstance.emit('unsubscribeDashboardStatus');
          billingDashboardSocketInstance.disconnect();
          billingDashboardSocketInstance = null;
        }
      }),
      map(() => disconnectBillingDashboardSocketSuccess()),
    );
  },
  { functional: true },
);

export const connectBillingDashboardSocketFailureFallback$ = createEffect(
  (actions$ = inject(Actions)) => {
    return actions$.pipe(
      ofType(connectBillingDashboardSocketFailure),
      map(() => loadOverviewServerInfo()),
    );
  },
  { functional: true },
);

export const billingDashboardSocketApplicationErrorFallback$ = createEffect(
  (actions$ = inject(Actions), environment = inject<Environment>(ENVIRONMENT)) => {
    return actions$.pipe(
      ofType(billingDashboardSocketApplicationError),
      filter(() => !!environment.billing.websocketUrl?.trim()),
      mergeMap(() => from([billingDashboardSocketDataReceived(), loadOverviewServerInfo()])),
    );
  },
  { functional: true },
);
