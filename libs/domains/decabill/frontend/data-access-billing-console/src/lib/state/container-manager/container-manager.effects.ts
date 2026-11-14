import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { catchError, filter, map, of, switchMap, takeUntil, timer, withLatestFrom } from 'rxjs';

import { ContainerManagerService } from '../../services/container-manager.service';

import {
  clearContainerManager,
  enterContainerManager,
  loadContainersFailure,
  loadContainersSuccess,
  loadLogs,
  loadLogsFailure,
  loadLogsSuccess,
  loadNetworksFailure,
  loadNetworksSuccess,
  loadStatsHistory,
  loadStatsHistoryFailure,
  loadStatsHistorySuccess,
  selectContainer,
} from './container-manager.actions';
import {
  selectContainerManagerAdminMode,
  selectContainerManagerItemId,
  selectContainerManagerSelectedContainerId,
  selectContainerManagerSubscriptionId,
} from './container-manager.selectors';

const LOG_POLL_INTERVAL_MS = 4_000;
const STATS_HISTORY_POLL_INTERVAL_MS = 30_000;

function normalizeError(error: unknown): string {
  if (error instanceof Error) return error.message;

  if (typeof error === 'string') return error;

  if (error && typeof error === 'object' && 'message' in error) return String(error.message);

  return 'An unexpected error occurred';
}

export const loadContainerManagerContainers$ = createEffect(
  (actions$ = inject(Actions), containerManagerService = inject(ContainerManagerService)) =>
    actions$.pipe(
      ofType(enterContainerManager),
      switchMap(({ subscriptionId, itemId, adminMode }) =>
        containerManagerService.listContainers(subscriptionId, itemId, adminMode === true).pipe(
          map((response) => loadContainersSuccess({ response })),
          catchError((error) => of(loadContainersFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const loadContainerManagerNetworks$ = createEffect(
  (actions$ = inject(Actions), containerManagerService = inject(ContainerManagerService)) =>
    actions$.pipe(
      ofType(enterContainerManager),
      switchMap(({ subscriptionId, itemId, adminMode }) =>
        containerManagerService.listNetworks(subscriptionId, itemId, adminMode === true).pipe(
          map((response) => loadNetworksSuccess({ response })),
          catchError((error) => of(loadNetworksFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const loadStatsHistoryOnSelect$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store)) =>
    actions$.pipe(
      ofType(selectContainer),
      filter(({ containerId }) => !!containerId),
      withLatestFrom(store.select(selectContainerManagerAdminMode)),
      map(([{ containerId }, adminMode]) => loadStatsHistory({ containerId: containerId!, adminMode })),
    ),
  { functional: true },
);

export const loadLogsOnSelect$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store)) =>
    actions$.pipe(
      ofType(selectContainer),
      filter(({ containerId }) => !!containerId),
      withLatestFrom(store.select(selectContainerManagerAdminMode)),
      map(([{ containerId }, adminMode]) => loadLogs({ containerId: containerId!, adminMode })),
    ),
  { functional: true },
);

export const loadStatsHistoryAfterContainers$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store)) =>
    actions$.pipe(
      ofType(loadContainersSuccess),
      withLatestFrom(store.select(selectContainerManagerAdminMode)),
      filter(([{ response }]) => (response.containers?.length ?? 0) > 0),
      map(([{ response }, adminMode]) => {
        const containerId = response.containers[0]?.id;

        return loadStatsHistory({ containerId: containerId!, adminMode });
      }),
    ),
  { functional: true },
);

export const loadLogsAfterContainers$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store)) =>
    actions$.pipe(
      ofType(loadContainersSuccess),
      withLatestFrom(
        store.select(selectContainerManagerAdminMode),
        store.select(selectContainerManagerSelectedContainerId),
      ),
      filter(
        ([{ response }, , selectedContainerId]) => !!selectedContainerId || (response.containers?.length ?? 0) > 0,
      ),
      map(([{ response }, adminMode, selectedContainerId]) => {
        const containerId = selectedContainerId ?? response.containers[0]?.id;

        return loadLogs({ containerId: containerId!, adminMode });
      }),
    ),
  { functional: true },
);

export const loadContainerManagerStatsHistory$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store), containerManagerService = inject(ContainerManagerService)) =>
    actions$.pipe(
      ofType(loadStatsHistory),
      withLatestFrom(store.select(selectContainerManagerSubscriptionId), store.select(selectContainerManagerItemId)),
      filter(([, subscriptionId, itemId]) => !!subscriptionId && !!itemId),
      switchMap(([{ containerId, adminMode }, subscriptionId, itemId]) =>
        containerManagerService.getStatsHistory(subscriptionId!, itemId!, containerId, adminMode === true).pipe(
          map((response) => loadStatsHistorySuccess({ response })),
          catchError((error) => of(loadStatsHistoryFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const loadContainerManagerLogs$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store), containerManagerService = inject(ContainerManagerService)) =>
    actions$.pipe(
      ofType(loadLogs),
      withLatestFrom(store.select(selectContainerManagerSubscriptionId), store.select(selectContainerManagerItemId)),
      filter(([, subscriptionId, itemId]) => !!subscriptionId && !!itemId),
      switchMap(([{ containerId, adminMode, silent }, subscriptionId, itemId]) =>
        containerManagerService.getLogs(subscriptionId!, itemId!, containerId, adminMode === true).pipe(
          map((response) => loadLogsSuccess({ response })),
          catchError((error) => of(loadLogsFailure({ error: normalizeError(error), silent }))),
        ),
      ),
    ),
  { functional: true },
);

export const pollContainerManagerLogs$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store)) =>
    actions$.pipe(
      ofType(loadLogsSuccess, selectContainer),
      switchMap(() =>
        timer(LOG_POLL_INTERVAL_MS, LOG_POLL_INTERVAL_MS).pipe(
          withLatestFrom(
            store.select(selectContainerManagerSelectedContainerId),
            store.select(selectContainerManagerAdminMode),
          ),
          filter(([, containerId]) => !!containerId),
          map(([, containerId, adminMode]) => loadLogs({ containerId: containerId!, adminMode, silent: true })),
          takeUntil(actions$.pipe(ofType(clearContainerManager, enterContainerManager, selectContainer))),
        ),
      ),
    ),
  { functional: true },
);

export const pollContainerManagerStatsHistory$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store)) =>
    actions$.pipe(
      ofType(loadStatsHistorySuccess, selectContainer),
      switchMap(() =>
        timer(STATS_HISTORY_POLL_INTERVAL_MS, STATS_HISTORY_POLL_INTERVAL_MS).pipe(
          withLatestFrom(
            store.select(selectContainerManagerSelectedContainerId),
            store.select(selectContainerManagerAdminMode),
          ),
          filter(([, containerId]) => !!containerId),
          map(([, containerId, adminMode]) => loadStatsHistory({ containerId: containerId!, adminMode })),
          takeUntil(actions$.pipe(ofType(clearContainerManager, enterContainerManager, selectContainer))),
        ),
      ),
    ),
  { functional: true },
);
