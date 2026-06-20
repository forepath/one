import { inject } from '@angular/core';
import type { Environment } from '@forepath/shared/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Action, Store } from '@ngrx/store';
import { Observable, catchError, forkJoin, from, map, mergeMap, of, switchMap, take } from 'rxjs';

import { SubscriptionItemsService } from '../../services/subscription-items.service';
import type { ServerInfoResponse, SubscriptionResponse } from '../../types/billing.types';
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

export function loadOverviewServerInfoEffect(
  actions$: Actions,
  store: Store,
  subscriptionItemsService: SubscriptionItemsService,
): Observable<ReturnType<typeof loadOverviewServerInfoSuccess> | ReturnType<typeof loadOverviewServerInfoFailure>> {
  return actions$.pipe(
    ofType(loadOverviewServerInfo),
    switchMap(() => store.select(selectSubscriptionsEntities).pipe(take(1))),
    switchMap((subscriptions: SubscriptionResponse[]) => {
      const activeSubscriptions = subscriptions.filter((sub) => sub.status === 'active');

      if (activeSubscriptions.length === 0) {
        return of(
          loadOverviewServerInfoSuccess({
            serverInfoBySubscriptionId: {},
            activeItemIdBySubscriptionId: {},
            serviceBySubscriptionId: {},
          }),
        );
      }

      return forkJoin(
        activeSubscriptions.map((sub) =>
          subscriptionItemsService.listSubscriptionItems(sub.id).pipe(map((items) => ({ sub, items }))),
        ),
      ).pipe(
        switchMap((results) => {
          const toFetch: { subscriptionId: string; itemId: string }[] = [];
          const serviceBySubscriptionId: Record<string, 'controller' | 'manager'> = {};

          results.forEach(({ sub, items }) => {
            const active = items.find((i) => i.provisioningStatus === 'active');

            if (active) {
              toFetch.push({ subscriptionId: sub.id, itemId: active.id });
              serviceBySubscriptionId[sub.id] = active.service ?? 'controller';
            }
          });

          if (toFetch.length === 0) {
            return of(
              loadOverviewServerInfoSuccess({
                serverInfoBySubscriptionId: {},
                activeItemIdBySubscriptionId: {},
                serviceBySubscriptionId: {},
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
              const activeItemIdBySubscriptionId: Record<string, string> = {};

              pairs.forEach((p) => {
                serverInfoBySubscriptionId[p.subscriptionId] = p.serverInfo;
                activeItemIdBySubscriptionId[p.subscriptionId] = p.itemId;
              });

              return loadOverviewServerInfoSuccess({
                serverInfoBySubscriptionId,
                activeItemIdBySubscriptionId,
                serviceBySubscriptionId,
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

function serverControlEffect(
  actionType: typeof startServer | typeof stopServer | typeof restartServer,
  successAction: typeof startServerSuccess | typeof stopServerSuccess | typeof restartServerSuccess,
  failureAction: typeof startServerFailure | typeof stopServerFailure | typeof restartServerFailure,
  apiCall: (subscriptionId: string, itemId: string) => Observable<unknown>,
  subscriptionItemsService: SubscriptionItemsService,
  environment: Environment,
) {
  const clearActionInProgressOnRefresh = !environment.billing.websocketUrl?.trim();

  return (actions$: Actions) =>
    actions$.pipe(
      ofType(actionType),
      switchMap(({ subscriptionId, itemId }) =>
        apiCall(subscriptionId, itemId).pipe(
          switchMap(() =>
            subscriptionItemsService.getServerInfo(subscriptionId, itemId).pipe(
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
        ),
      ),
    );
}

export function startServerEffect(
  actions$: Actions,
  subscriptionItemsService: SubscriptionItemsService,
  environment: Environment,
): Observable<Action> {
  return serverControlEffect(
    startServer,
    startServerSuccess,
    startServerFailure,
    (subId, itemId) => subscriptionItemsService.startServer(subId, itemId),
    subscriptionItemsService,
    environment,
  )(actions$);
}

export function stopServerEffect(
  actions$: Actions,
  subscriptionItemsService: SubscriptionItemsService,
  environment: Environment,
): Observable<Action> {
  return serverControlEffect(
    stopServer,
    stopServerSuccess,
    stopServerFailure,
    (subId, itemId) => subscriptionItemsService.stopServer(subId, itemId),
    subscriptionItemsService,
    environment,
  )(actions$);
}

export function restartServerEffect(
  actions$: Actions,
  subscriptionItemsService: SubscriptionItemsService,
  environment: Environment,
): Observable<Action> {
  return serverControlEffect(
    restartServer,
    restartServerSuccess,
    restartServerFailure,
    (subId, itemId) => subscriptionItemsService.restartServer(subId, itemId),
    subscriptionItemsService,
    environment,
  )(actions$);
}

export const startServer$ = createEffect(
  (
    actions$ = inject(Actions),
    subscriptionItemsService = inject(SubscriptionItemsService),
    environment = inject<Environment>(ENVIRONMENT),
  ) => startServerEffect(actions$, subscriptionItemsService, environment),
  { functional: true },
);
export const stopServer$ = createEffect(
  (
    actions$ = inject(Actions),
    subscriptionItemsService = inject(SubscriptionItemsService),
    environment = inject<Environment>(ENVIRONMENT),
  ) => stopServerEffect(actions$, subscriptionItemsService, environment),
  { functional: true },
);
export const restartServer$ = createEffect(
  (
    actions$ = inject(Actions),
    subscriptionItemsService = inject(SubscriptionItemsService),
    environment = inject<Environment>(ENVIRONMENT),
  ) => restartServerEffect(actions$, subscriptionItemsService, environment),
  { functional: true },
);
