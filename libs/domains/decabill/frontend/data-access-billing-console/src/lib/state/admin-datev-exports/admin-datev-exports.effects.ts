import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import {
  catchError,
  EMPTY,
  filter,
  interval,
  map,
  merge,
  mergeMap,
  of,
  switchMap,
  takeUntil,
  tap,
  timer,
  withLatestFrom,
} from 'rxjs';

import { BILLING_LIST_PAGE_SIZE } from '../../constants/list-paging.constants';
import { AdminBillingService } from '../../services/admin-billing.service';
import type { DatevExportScope } from '../../types/billing.types';

import {
  downloadDatevExport,
  downloadDatevExportFailure,
  downloadDatevExportSuccess,
  expireQueuedDatevExports,
  loadAdminDatevExports,
  loadAdminDatevExportsFailure,
  loadAdminDatevExportsSuccess,
  resolveQueuedDatevExports,
  triggerDatevExport,
  triggerDatevExportFailure,
  triggerDatevExportSuccess,
} from './admin-datev-exports.actions';
import type { AdminDatevExportsState } from './admin-datev-exports.reducer';
import { selectAdminDatevExportsState } from './admin-datev-exports.selectors';

export const QUEUED_POLL_INTERVAL_MS = 3000;
export const QUEUED_POLL_TIMEOUT_MS = 5 * 60 * 1000;
/** A year has at most 12 periods per scope: one request per queued (scope, year) resolves its placeholders. */
const QUEUED_RESOLVE_LIMIT = 100;

function resolveLoadedScope(params: { scope?: DatevExportScope }): DatevExportScope {
  return params.scope ?? 'tenant';
}

/** The current page again (scope, tenant view, search, year, window kept). */
function reloadCurrentPage(state: AdminDatevExportsState) {
  return loadAdminDatevExports({
    params: {
      scope: state.scope,
      viewTenantId: state.viewTenantId ?? undefined,
      search: state.search ?? undefined,
      year: state.year ?? undefined,
      limit: state.limit,
      offset: state.offset,
    },
    preserveScope: true,
  });
}

/** One page of exports (replace-page): `limit` / `offset` from the action, page size 25 by default. */
export const loadAdminDatevExports$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminBillingService)) =>
    actions$.pipe(
      ofType(loadAdminDatevExports),
      switchMap(({ params }) => {
        const limit = params.limit && params.limit > 0 ? params.limit : BILLING_LIST_PAGE_SIZE;
        const offset = params.offset && params.offset > 0 ? params.offset : 0;
        const requestParams = { ...params, limit, offset };
        const loadedScope = resolveLoadedScope(requestParams);

        return service.listDatevExports(requestParams).pipe(
          map((response) =>
            loadAdminDatevExportsSuccess({ items: response.items, total: response.total, limit, offset, loadedScope }),
          ),
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
      withLatestFrom(store.select(selectAdminDatevExportsState)),
      map(([, state]) => reloadCurrentPage(state)),
    ),
  { functional: true },
);

/**
 * While exports are queued: every few seconds one request per queued (scope, year) — independent of the page the
 * admin is on — resolves the placeholders; when one resolves, the current page reloads (replace-page).
 */
export const pollQueuedDatevExports$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store), service = inject(AdminBillingService)) =>
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
            const keys = [...new Set(state.queuedExports.map((queued) => `${queued.scope}|${queued.periodYear}`))];

            return merge(
              ...keys.map((key) => {
                const [scope, year] = key.split('|') as [DatevExportScope, string];

                return service
                  .listDatevExports({
                    scope,
                    viewTenantId: scope === 'tenant' ? (state.viewTenantId ?? undefined) : undefined,
                    year: Number(year),
                    limit: QUEUED_RESOLVE_LIMIT,
                    offset: 0,
                  })
                  .pipe(
                    withLatestFrom(store.select(selectAdminDatevExportsState)),
                    mergeMap(([response, current]) => {
                      const resolved = current.queuedExports.some(
                        (queued) =>
                          queued.scope === scope &&
                          response.items.some(
                            (item) =>
                              item.scope === queued.scope &&
                              item.periodYear === queued.periodYear &&
                              item.periodMonth === queued.periodMonth,
                          ),
                      );
                      const resolveAction = resolveQueuedDatevExports({ items: response.items, loadedScope: scope });

                      return resolved ? [resolveAction, reloadCurrentPage(current)] : [resolveAction];
                    }),
                    catchError(() => EMPTY),
                  );
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
      switchMap(({ exportId, viewTenantId }) =>
        service.downloadDatevExport(exportId, viewTenantId).pipe(
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
