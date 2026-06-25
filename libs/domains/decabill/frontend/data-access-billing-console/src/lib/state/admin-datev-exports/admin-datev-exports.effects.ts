import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import {
  catchError,
  filter,
  interval,
  map,
  mergeMap,
  of,
  switchMap,
  takeUntil,
  tap,
  timer,
  withLatestFrom,
} from 'rxjs';

import { AdminBillingService } from '../../services/admin-billing.service';
import type { DatevExportScope } from '../../types/billing.types';

import {
  downloadDatevExport,
  downloadDatevExportFailure,
  downloadDatevExportSuccess,
  expireQueuedDatevExports,
  loadAdminDatevExports,
  loadAdminDatevExportsBatch,
  loadAdminDatevExportsFailure,
  loadAdminDatevExportsSuccess,
  triggerDatevExport,
  triggerDatevExportFailure,
  triggerDatevExportSuccess,
} from './admin-datev-exports.actions';
import { selectAdminDatevExportsScope, selectAdminDatevExportsState } from './admin-datev-exports.selectors';

const BATCH_SIZE = 10;
export const QUEUED_POLL_INTERVAL_MS = 3000;
export const QUEUED_POLL_TIMEOUT_MS = 5 * 60 * 1000;

function resolveLoadedScope(params: { scope?: DatevExportScope }): DatevExportScope {
  return params.scope ?? 'tenant';
}

export const loadAdminDatevExports$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminBillingService)) =>
    actions$.pipe(
      ofType(loadAdminDatevExports),
      switchMap(({ params }) => {
        const requestParams = { ...params, limit: BATCH_SIZE, offset: 0 };
        const loadedScope = resolveLoadedScope(requestParams);

        return service.listDatevExports(requestParams).pipe(
          switchMap((response) => {
            if (response.items.length === 0) {
              return of(
                loadAdminDatevExportsSuccess({
                  items: [],
                  total: response.total,
                  limit: BATCH_SIZE,
                  offset: 0,
                  loadedScope,
                }),
              );
            }

            if (response.items.length < BATCH_SIZE) {
              return of(
                loadAdminDatevExportsSuccess({
                  items: response.items,
                  total: response.total,
                  limit: BATCH_SIZE,
                  offset: 0,
                  loadedScope,
                }),
              );
            }

            return of(
              loadAdminDatevExportsBatch({
                params: requestParams,
                offset: BATCH_SIZE,
                accumulatedItems: response.items,
              }),
            );
          }),
          catchError((error: Error) =>
            of(loadAdminDatevExportsFailure({ error: error.message ?? 'Failed to load DATEV exports' })),
          ),
        );
      }),
    ),
  { functional: true },
);

export const loadAdminDatevExportsBatch$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminBillingService)) =>
    actions$.pipe(
      ofType(loadAdminDatevExportsBatch),
      switchMap(({ params, offset, accumulatedItems }) => {
        const loadedScope = resolveLoadedScope(params);

        return service.listDatevExports({ ...params, limit: BATCH_SIZE, offset }).pipe(
          switchMap((response) => {
            const newAccumulated = [...accumulatedItems, ...response.items];

            if (response.items.length === 0 || response.items.length < BATCH_SIZE) {
              return of(
                loadAdminDatevExportsSuccess({
                  items: newAccumulated,
                  total: response.total,
                  limit: BATCH_SIZE,
                  offset: 0,
                  loadedScope,
                }),
              );
            }

            return of(
              loadAdminDatevExportsBatch({
                params,
                offset: offset + BATCH_SIZE,
                accumulatedItems: newAccumulated,
              }),
            );
          }),
          catchError((error: Error) =>
            of(loadAdminDatevExportsFailure({ error: error.message ?? 'Failed to load DATEV exports' })),
          ),
        );
      }),
    ),
  { functional: true },
);

export const triggerDatevExport$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminBillingService)) =>
    actions$.pipe(
      ofType(triggerDatevExport),
      switchMap(({ dto }) =>
        service.triggerDatevExport(dto).pipe(
          map((result) => triggerDatevExportSuccess({ result, queuedAt: new Date().toISOString() })),
          catchError((error: Error) =>
            of(triggerDatevExportFailure({ error: error.message ?? 'Failed to trigger DATEV export' })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const triggerDatevExportSuccessReload$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store)) =>
    actions$.pipe(
      ofType(triggerDatevExportSuccess),
      withLatestFrom(store.select(selectAdminDatevExportsScope)),
      map(([, scope]) =>
        loadAdminDatevExports({
          params: { scope, limit: BATCH_SIZE, offset: 0 },
          preserveScope: true,
        }),
      ),
    ),
  { functional: true },
);

export const pollQueuedDatevExports$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store)) =>
    actions$.pipe(
      ofType(triggerDatevExportSuccess),
      filter(({ result }) => result.queued),
      switchMap(() =>
        interval(QUEUED_POLL_INTERVAL_MS).pipe(
          takeUntil(
            store.select(selectAdminDatevExportsState).pipe(filter((state) => state.queuedExports.length === 0)),
          ),
          withLatestFrom(store.select(selectAdminDatevExportsState)),
          mergeMap(([, state]) => {
            const scopes = [...new Set(state.queuedExports.map((queued) => queued.scope))];

            if (scopes.length === 0) {
              return [];
            }

            return scopes.map((scope) =>
              loadAdminDatevExports({
                params: { scope, limit: BATCH_SIZE, offset: 0 },
                preserveScope: true,
              }),
            );
          }),
        ),
      ),
    ),
  { functional: true },
);

export const expireQueuedDatevExports$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store)) =>
    actions$.pipe(
      ofType(triggerDatevExportSuccess),
      filter(({ result }) => result.queued),
      switchMap(() =>
        timer(QUEUED_POLL_TIMEOUT_MS).pipe(
          withLatestFrom(store.select(selectAdminDatevExportsState)),
          filter(([, state]) => state.queuedExports.length > 0),
          map(() => expireQueuedDatevExports()),
        ),
      ),
    ),
  { functional: true },
);

export const downloadDatevExport$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminBillingService)) =>
    actions$.pipe(
      ofType(downloadDatevExport),
      switchMap(({ exportId }) =>
        service.downloadDatevExport(exportId).pipe(
          tap((blob) => {
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');

            anchor.href = url;
            anchor.download = `datev-export-${exportId}.zip`;
            anchor.click();
            URL.revokeObjectURL(url);
          }),
          map(() => downloadDatevExportSuccess()),
          catchError((error: Error) =>
            of(downloadDatevExportFailure({ error: error.message ?? 'Failed to download DATEV export' })),
          ),
        ),
      ),
    ),
  { functional: true },
);
