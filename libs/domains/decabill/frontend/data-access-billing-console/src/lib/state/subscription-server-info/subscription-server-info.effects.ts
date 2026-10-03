import { inject } from '@angular/core';
import type { Environment } from '@forepath/decabill/frontend/util-configuration';
import { ENVIRONMENT, resolveApiWebsocketUrl } from '@forepath/decabill/frontend/util-configuration';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Action, Store } from '@ngrx/store';
import { Observable, catchError, forkJoin, from, map, mergeMap, of, switchMap, take } from 'rxjs';

import { SubscriptionItemsService } from '../../services/subscription-items.service';
import { AdminBillingService } from '../../services/admin-billing.service';
import type {
  ProvisioningServiceKind,
  ProvisioningStatus,
  ServerInfoResponse,
  SubscriptionItemResponse,
  SubscriptionResponse,
} from '../../types/billing.types';
import { isLiveAccessibleSubscriptionStatus } from '../../utils/service-display-label.util';
import { createSubscriptionSuccess } from '../subscriptions/subscriptions.actions';
import { selectSubscriptionsEntities } from '../subscriptions/subscriptions.selectors';

import {
  loadOverviewServerInfo,
  loadOverviewServerInfoFailure,
  loadOverviewServerInfoSuccess,
  refreshSubscriptionServerInfoSuccess,
  restartServer,
  restartServerFailure,
  restartServerSuccess,
  startServer,
  startServerFailure,
  startServerSuccess,
  stopServer,
  stopServerFailure,
  stopServerSuccess,
} from './subscription-server-info.actions';

function normalizeError(error: unknown): string {
  if (error instanceof Error) return error.message;

  if (typeof error === 'string') return error;

  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }

  return 'An unexpected error occurred';
}

function pickTrackedSubscriptionItem(items: SubscriptionItemResponse[]): SubscriptionItemResponse | undefined {
  return (
    items.find((item) => item.provisioningStatus === 'active') ??
    items.find((item) => item.provisioningStatus === 'pending') ??
    items.find((item) => item.provisioningStatus === 'failed')
  );
}

export function loadOverviewServerInfoEffect(
  actions$: Actions,
  store: Store,
  subscriptionItemsService: SubscriptionItemsService,
): Observable<ReturnType<typeof loadOverviewServerInfoSuccess> | ReturnType<typeof loadOverviewServerInfoFailure>> {
  return actions$.pipe(
    ofType(loadOverviewServerInfo),
    switchMap(() => store.select(selectSubscriptionsEntities).pipe(take(1))),
    switchMap((subscriptions: SubscriptionResponse[]) => {
      const accessibleSubscriptions = subscriptions.filter((sub) => isLiveAccessibleSubscriptionStatus(sub.status));

      if (accessibleSubscriptions.length === 0) {
        return of(
          loadOverviewServerInfoSuccess({
            serverInfoBySubscriptionId: {},
            activeItemIdBySubscriptionId: {},
            serviceBySubscriptionId: {},
            provisioningStatusBySubscriptionId: {},
            sshAccessGrantedBySubscriptionId: {},
            serviceTypeNameBySubscriptionId: {},
            displayNameBySubscriptionId: {},
          }),
        );
      }

      return forkJoin(
        accessibleSubscriptions.map((sub) =>
          subscriptionItemsService.listSubscriptionItems(sub.id).pipe(map((items) => ({ sub, items }))),
        ),
      ).pipe(
        switchMap((results) => {
          const toFetch: { subscriptionId: string; itemId: string }[] = [];
          const serviceBySubscriptionId: Record<string, ProvisioningServiceKind> = {};
          const activeItemIdBySubscriptionId: Record<string, string> = {};
          const provisioningStatusBySubscriptionId: Record<string, ProvisioningStatus> = {};
          const sshAccessGrantedBySubscriptionId: Record<string, boolean> = {};
          const serviceTypeNameBySubscriptionId: Record<string, string> = {};
          const displayNameBySubscriptionId: Record<string, string | null> = {};

          results.forEach(({ sub, items }) => {
            const tracked = pickTrackedSubscriptionItem(items);

            if (!tracked) {
              return;
            }

            activeItemIdBySubscriptionId[sub.id] = tracked.id;
            serviceBySubscriptionId[sub.id] = tracked.service ?? 'agenstra-controller';
            provisioningStatusBySubscriptionId[sub.id] = tracked.provisioningStatus;
            sshAccessGrantedBySubscriptionId[sub.id] = tracked.sshAccessGranted === true;
            if (tracked.serviceTypeName?.trim()) {
              serviceTypeNameBySubscriptionId[sub.id] = tracked.serviceTypeName.trim();
            }
            if (tracked.displayName !== undefined) {
              displayNameBySubscriptionId[sub.id] = tracked.displayName;
            }

            if (tracked.provisioningStatus === 'active') {
              toFetch.push({ subscriptionId: sub.id, itemId: tracked.id });
            }
          });

          if (toFetch.length === 0) {
            return of(
              loadOverviewServerInfoSuccess({
                serverInfoBySubscriptionId: {},
                activeItemIdBySubscriptionId,
                serviceBySubscriptionId,
                provisioningStatusBySubscriptionId,
                sshAccessGrantedBySubscriptionId,
                serviceTypeNameBySubscriptionId,
                displayNameBySubscriptionId,
              }),
            );
          }

          return forkJoin(
            toFetch.map(({ subscriptionId, itemId }) =>
              subscriptionItemsService
                .getServerInfo(subscriptionId, itemId)
                .pipe(map((serverInfo) => ({ subscriptionId, itemId, serverInfo }))),
            ),
          ).pipe(
            map((pairs) => {
              const serverInfoBySubscriptionId: Record<string, ServerInfoResponse> = {};

              pairs.forEach((pair) => {
                serverInfoBySubscriptionId[pair.subscriptionId] = pair.serverInfo;
              });

              return loadOverviewServerInfoSuccess({
                serverInfoBySubscriptionId,
                activeItemIdBySubscriptionId,
                serviceBySubscriptionId,
                provisioningStatusBySubscriptionId,
                sshAccessGrantedBySubscriptionId,
                serviceTypeNameBySubscriptionId,
                displayNameBySubscriptionId,
              });
            }),
          );
        }),
      );
    }),
    catchError((error) => of(loadOverviewServerInfoFailure({ error: normalizeError(error) }))),
  );
}

export const loadOverviewServerInfo$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store), subscriptionItemsService = inject(SubscriptionItemsService)) =>
    loadOverviewServerInfoEffect(actions$, store, subscriptionItemsService),
  { functional: true },
);

export function reloadProvisioningAfterOrderEffect(
  actions$: Actions,
): Observable<ReturnType<typeof loadOverviewServerInfo>> {
  return actions$.pipe(
    ofType(createSubscriptionSuccess),
    map(() => loadOverviewServerInfo()),
  );
}

export const reloadProvisioningAfterOrder$ = createEffect(
  (actions$ = inject(Actions)) => reloadProvisioningAfterOrderEffect(actions$),
  { functional: true },
);

function serverControlEffect(
  actionType: typeof startServer | typeof stopServer | typeof restartServer,
  successAction: typeof startServerSuccess | typeof stopServerSuccess | typeof restartServerSuccess,
  failureAction: typeof startServerFailure | typeof stopServerFailure | typeof restartServerFailure,
  customerApiCall: (subscriptionId: string, itemId: string) => Observable<unknown>,
  adminApiCall: (subscriptionId: string, itemId: string) => Observable<unknown>,
  customerServerInfoCall: (subscriptionId: string, itemId: string) => Observable<ServerInfoResponse>,
  adminServerInfoCall: (subscriptionId: string, itemId: string) => Observable<ServerInfoResponse>,
  environment: Environment,
) {
  const clearActionInProgressOnRefresh = !resolveApiWebsocketUrl(environment.billing.urls.websocket, 'default');

  return (actions$: Actions) =>
    actions$.pipe(
      ofType(actionType),
      switchMap(({ subscriptionId, itemId, adminMode }) => {
        const apiCall = adminMode ? adminApiCall : customerApiCall;
        const serverInfoCall = adminMode ? adminServerInfoCall : customerServerInfoCall;

        return apiCall(subscriptionId, itemId).pipe(
          switchMap(() =>
            serverInfoCall(subscriptionId, itemId).pipe(
              mergeMap((serverInfo) =>
                from([
                  successAction({ subscriptionId, itemId }),
                  refreshSubscriptionServerInfoSuccess({
                    subscriptionId,
                    serverInfo,
                    clearActionInProgress: clearActionInProgressOnRefresh,
                  }),
                ]),
              ),
            ),
          ),
          catchError((error) => of(failureAction({ subscriptionId, error: normalizeError(error) }))),
        );
      }),
    );
}

export function startServerEffect(
  actions$: Actions,
  subscriptionItemsService: SubscriptionItemsService,
  adminBillingService: AdminBillingService,
  environment: Environment,
): Observable<Action> {
  return serverControlEffect(
    startServer,
    startServerSuccess,
    startServerFailure,
    (subId, itemId) => subscriptionItemsService.startServer(subId, itemId),
    (subId, itemId) => adminBillingService.startAdminSubscriptionItemServer(subId, itemId),
    (subId, itemId) => subscriptionItemsService.getServerInfo(subId, itemId),
    (subId, itemId) => adminBillingService.getAdminSubscriptionItemServerInfo(subId, itemId),
    environment,
  )(actions$);
}

export function stopServerEffect(
  actions$: Actions,
  subscriptionItemsService: SubscriptionItemsService,
  adminBillingService: AdminBillingService,
  environment: Environment,
): Observable<Action> {
  return serverControlEffect(
    stopServer,
    stopServerSuccess,
    stopServerFailure,
    (subId, itemId) => subscriptionItemsService.stopServer(subId, itemId),
    (subId, itemId) => adminBillingService.stopAdminSubscriptionItemServer(subId, itemId),
    (subId, itemId) => subscriptionItemsService.getServerInfo(subId, itemId),
    (subId, itemId) => adminBillingService.getAdminSubscriptionItemServerInfo(subId, itemId),
    environment,
  )(actions$);
}

export function restartServerEffect(
  actions$: Actions,
  subscriptionItemsService: SubscriptionItemsService,
  adminBillingService: AdminBillingService,
  environment: Environment,
): Observable<Action> {
  return serverControlEffect(
    restartServer,
    restartServerSuccess,
    restartServerFailure,
    (subId, itemId) => subscriptionItemsService.restartServer(subId, itemId),
    (subId, itemId) => adminBillingService.restartAdminSubscriptionItemServer(subId, itemId),
    (subId, itemId) => subscriptionItemsService.getServerInfo(subId, itemId),
    (subId, itemId) => adminBillingService.getAdminSubscriptionItemServerInfo(subId, itemId),
    environment,
  )(actions$);
}

export const startServer$ = createEffect(
  (
    actions$ = inject(Actions),
    subscriptionItemsService = inject(SubscriptionItemsService),
    adminBillingService = inject(AdminBillingService),
    environment = inject<Environment>(ENVIRONMENT),
  ) => startServerEffect(actions$, subscriptionItemsService, adminBillingService, environment),
  { functional: true },
);
export const stopServer$ = createEffect(
  (
    actions$ = inject(Actions),
    subscriptionItemsService = inject(SubscriptionItemsService),
    adminBillingService = inject(AdminBillingService),
    environment = inject<Environment>(ENVIRONMENT),
  ) => stopServerEffect(actions$, subscriptionItemsService, adminBillingService, environment),
  { functional: true },
);
export const restartServer$ = createEffect(
  (
    actions$ = inject(Actions),
    subscriptionItemsService = inject(SubscriptionItemsService),
    adminBillingService = inject(AdminBillingService),
    environment = inject<Environment>(ENVIRONMENT),
  ) => restartServerEffect(actions$, subscriptionItemsService, adminBillingService, environment),
  { functional: true },
);
