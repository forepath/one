import { inject } from '@angular/core';
import type { Environment } from '@forepath/decabill/frontend/util-configuration';
import { ENVIRONMENT, resolveApiWebsocketUrl } from '@forepath/decabill/frontend/util-configuration';
import { createSocketAuthOption, OidcAuthService, resolveAuthorizationHeader$ } from '@forepath/identity/frontend';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, filter, from, fromEvent, map, merge, mergeMap, of, switchMap, take, takeUntil, tap } from 'rxjs';
import { io, Socket } from 'socket.io-client';

import { resolveBillingTenantId } from '../../interceptors/tenant.interceptor';
import type { BillingDashboardStatusUpdatePayload, BillingMeterSummaryUpdatePayload } from '../../types/billing.types';
import { meterSummaryPush } from '../service-detail/service-detail.actions';
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
  subscribeBillingSubscriptionMeters,
  unsubscribeBillingSubscriptionMeters,
} from './billing-dashboard-socket.actions';

let billingDashboardSocketInstance: Socket | null = null;

export function getBillingDashboardSocketInstance(): Socket | null {
  return billingDashboardSocketInstance;
}

export const connectBillingDashboardSocket$ = createEffect(
  (
    actions$ = inject(Actions),
    environment = inject<Environment>(ENVIRONMENT),
    oidcAuthService = inject(OidcAuthService),
  ) => {
    return actions$.pipe(
      ofType(connectBillingDashboardSocket),
      switchMap(() => {
        const websocketUrl = resolveApiWebsocketUrl(environment.billing.urls.websocket, 'default');

        if (!websocketUrl) {
          return of(connectBillingDashboardSocketFailure({ error: 'Billing WebSocket URL not configured' }));
        }

        if (billingDashboardSocketInstance) {
          billingDashboardSocketInstance.disconnect();
          billingDashboardSocketInstance = null;
        }

        return resolveAuthorizationHeader$(environment.authentication.config, oidcAuthService).pipe(
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
              auth: createSocketAuthOption(environment.authentication.config, authHeader, {
                tenantId: resolveBillingTenantId(environment),
              }),
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
            const meterSummaryUpdate$ = fromEvent<BillingMeterSummaryUpdatePayload>(socket, 'meterSummaryUpdate').pipe(
              map((payload) => meterSummaryPush({ subscriptionId: payload.subscriptionId, meters: payload.meters })),
            );
            const appError$ = fromEvent<{ message: string }>(socket, 'error').pipe(
              map((data) => billingDashboardSocketApplicationError({ message: data.message ?? 'Socket error' })),
            );

            return merge(connectSuccess$, connectError$, statusUpdate$, meterSummaryUpdate$, appError$).pipe(
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
      filter(() => !!resolveApiWebsocketUrl(environment.billing.urls.websocket, 'default')),
      mergeMap(() => from([billingDashboardSocketDataReceived(), loadOverviewServerInfo()])),
    );
  },
  { functional: true },
);

export const subscribeBillingSubscriptionMeters$ = createEffect(
  (actions$ = inject(Actions)) =>
    actions$.pipe(
      ofType(subscribeBillingSubscriptionMeters),
      tap(({ subscriptionId }) => {
        getBillingDashboardSocketInstance()?.emit('subscribeSubscriptionMeters', { subscriptionId });
      }),
    ),
  { functional: true, dispatch: false },
);

export const unsubscribeBillingSubscriptionMeters$ = createEffect(
  (actions$ = inject(Actions)) =>
    actions$.pipe(
      ofType(unsubscribeBillingSubscriptionMeters),
      tap(({ subscriptionId }) => {
        getBillingDashboardSocketInstance()?.emit('unsubscribeSubscriptionMeters', { subscriptionId });
      }),
    ),
  { functional: true, dispatch: false },
);
