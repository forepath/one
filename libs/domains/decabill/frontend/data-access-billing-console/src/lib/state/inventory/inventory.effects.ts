import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import {
  buffer,
  catchError,
  concatMap,
  debounceTime,
  filter,
  from,
  map,
  mergeMap,
  of,
  switchMap,
  withLatestFrom,
} from 'rxjs';
import type { Observable } from 'rxjs';

import { billingPageWindow } from '../../constants/list-paging.constants';
import { AdminInventoryService } from '../../services/admin-inventory.service';
import type { PaginatedInventoryResponse } from '../../types/inventory.types';

import {
  type InventoryMutation,
  type InventorySliceKey,
  loadInventoryArticle,
  loadInventoryArticles,
  loadInventoryArticleStock,
  loadInventoryArticleSuccess,
  loadInventoryCompartments,
  loadInventoryCompartmentStock,
  loadInventoryLendings,
  loadInventoryMovements,
  loadInventoryRequests,
  loadInventorySerialUnits,
  loadInventorySliceFailure,
  loadInventorySliceSuccess,
  loadInventorySummary,
  loadInventorySummarySuccess,
  loadInventoryWarehouses,
  reloadInventorySlices,
  runInventoryMutation,
  runInventoryMutationFailure,
  runInventoryMutationSuccess,
} from './inventory.actions';
import type { InventoryState } from './inventory.reducer';
import { selectInventoryState } from './inventory.selectors';

export function normalizeInventoryError(error: unknown): string {
  if (error && typeof error === 'object' && 'error' in error) {
    const body = (error as { error?: { message?: unknown } }).error;
    const message = body?.message;

    if (Array.isArray(message)) return message.join(', ');

    if (typeof message === 'string') return message;
  }

  if (error instanceof Error) return error.message;

  if (typeof error === 'string') return error;

  return 'An unexpected error occurred';
}

function toSlice(slice: InventorySliceKey) {
  return (source: Observable<PaginatedInventoryResponse<unknown>>) =>
    source.pipe(
      map((response) => loadInventorySliceSuccess({ slice, items: response.items, total: response.total })),
      catchError((error) => of(loadInventorySliceFailure({ slice, error: normalizeInventoryError(error) }))),
    );
}

function pageOf(page?: number, pageSize?: number) {
  const { limit, offset } = billingPageWindow(page, pageSize);

  return { limit, offset };
}

// One effect per list: a newer request of a list cancels its older one, other lists are unaffected.

export const loadInventoryWarehouses$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminInventoryService)) =>
    actions$.pipe(
      ofType(loadInventoryWarehouses),
      switchMap(({ page, pageSize, search }) =>
        service.listWarehouses({ ...pageOf(page, pageSize), search }).pipe(toSlice('warehouses')),
      ),
    ),
  { functional: true },
);

export const loadInventoryCompartments$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminInventoryService), store = inject(Store)) =>
    actions$.pipe(
      ofType(loadInventoryCompartments),
      withLatestFrom(store.select(selectInventoryState)),
      switchMap(([{ warehouseId }, state]) =>
        service
          .listCompartments({
            ...pageOf(state.compartments.page, state.compartments.pageSize),
            search: state.compartments.search ?? undefined,
            warehouseId,
          })
          .pipe(toSlice('compartments')),
      ),
    ),
  { functional: true },
);

export const loadInventoryCompartmentStock$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminInventoryService), store = inject(Store)) =>
    actions$.pipe(
      ofType(loadInventoryCompartmentStock),
      withLatestFrom(store.select(selectInventoryState)),
      switchMap(([{ compartmentId }, state]) =>
        service
          .listCompartmentStock(compartmentId, {
            ...pageOf(state.compartmentStock.page, state.compartmentStock.pageSize),
            search: state.compartmentStock.search ?? undefined,
          })
          .pipe(toSlice('compartmentStock')),
      ),
    ),
  { functional: true },
);

export const loadInventoryArticles$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminInventoryService), store = inject(Store)) =>
    actions$.pipe(
      ofType(loadInventoryArticles),
      withLatestFrom(store.select(selectInventoryState)),
      switchMap(([, state]) =>
        service
          .listArticles({
            ...pageOf(state.articles.page, state.articles.pageSize),
            search: state.articles.search ?? undefined,
            lowStockOnly: state.articleFilters.lowStockOnly || undefined,
            activeOnly: state.articleFilters.activeOnly || undefined,
          })
          .pipe(toSlice('articles')),
      ),
    ),
  { functional: true },
);

export const loadInventoryArticleStock$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminInventoryService), store = inject(Store)) =>
    actions$.pipe(
      ofType(loadInventoryArticleStock),
      withLatestFrom(store.select(selectInventoryState)),
      switchMap(([{ articleId }, state]) =>
        service
          .listArticleStock(articleId, {
            ...pageOf(state.articleStock.page, state.articleStock.pageSize),
            search: state.articleStock.search ?? undefined,
          })
          .pipe(toSlice('articleStock')),
      ),
    ),
  { functional: true },
);

export const loadInventoryRequests$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminInventoryService), store = inject(Store)) =>
    actions$.pipe(
      ofType(loadInventoryRequests),
      withLatestFrom(store.select(selectInventoryState)),
      switchMap(([, state]) =>
        service
          .listRequests({
            ...pageOf(state.requests.page, state.requests.pageSize),
            search: state.requests.search ?? undefined,
            status: state.requestStatus ?? undefined,
          })
          .pipe(toSlice('requests')),
      ),
    ),
  { functional: true },
);

export const loadInventoryMovements$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminInventoryService), store = inject(Store)) =>
    actions$.pipe(
      ofType(loadInventoryMovements),
      withLatestFrom(store.select(selectInventoryState)),
      switchMap(([, state]) =>
        service
          .listMovements({
            ...pageOf(state.movements.page, state.movements.pageSize),
            search: state.movements.search ?? undefined,
            ...state.movementFilters,
          })
          .pipe(toSlice('movements')),
      ),
    ),
  { functional: true },
);

export const loadInventoryLendings$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminInventoryService), store = inject(Store)) =>
    actions$.pipe(
      ofType(loadInventoryLendings),
      withLatestFrom(store.select(selectInventoryState)),
      switchMap(([, state]) =>
        service
          .listLendings({
            ...pageOf(state.lendings.page, state.lendings.pageSize),
            search: state.lendings.search ?? undefined,
            ...state.lendingFilters,
          })
          .pipe(toSlice('lendings')),
      ),
    ),
  { functional: true },
);

export const loadInventorySerialUnits$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminInventoryService), store = inject(Store)) =>
    actions$.pipe(
      ofType(loadInventorySerialUnits),
      withLatestFrom(store.select(selectInventoryState)),
      switchMap(([{ articleId }, state]) =>
        service
          .listSerialUnits({
            ...pageOf(state.serialUnits.page, state.serialUnits.pageSize),
            search: state.serialUnits.search ?? undefined,
            articleId,
            status: state.serialUnitStatus ?? undefined,
          })
          .pipe(toSlice('serialUnits')),
      ),
    ),
  { functional: true },
);

export const loadInventorySummary$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminInventoryService)) =>
    actions$.pipe(
      ofType(loadInventorySummary),
      switchMap(() =>
        service.getSummary().pipe(
          map((summary) => loadInventorySummarySuccess({ summary })),
          catchError(() => of({ type: '[Inventory] Load Summary Failure' })),
        ),
      ),
    ),
  { functional: true },
);

export const loadInventoryArticle$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminInventoryService)) =>
    actions$.pipe(
      ofType(loadInventoryArticle),
      switchMap(({ articleId }) =>
        service.getArticle(articleId).pipe(
          map((article) => loadInventoryArticleSuccess({ article })),
          catchError((error) =>
            of(runInventoryMutationFailure({ kind: 'saveArticle', error: normalizeInventoryError(error) })),
          ),
        ),
      ),
    ),
  { functional: true },
);

/** The load action re-requesting the current page of a slice (silently), or null when it is not open. */
export function reloadActionFor(slice: InventorySliceKey, state: InventoryState) {
  const current = state[slice];

  if (!current.loaded && !current.loading) return null;

  const query = { page: current.page, pageSize: current.pageSize, silent: true };

  switch (slice) {
    case 'warehouses':
      return loadInventoryWarehouses(query);
    case 'compartments':
      return current.scopeId ? loadInventoryCompartments({ ...query, warehouseId: current.scopeId }) : null;
    case 'compartmentStock':
      return current.scopeId ? loadInventoryCompartmentStock({ ...query, compartmentId: current.scopeId }) : null;
    case 'articles':
      return loadInventoryArticles(query);
    case 'articleStock':
      return current.scopeId ? loadInventoryArticleStock({ ...query, articleId: current.scopeId }) : null;
    case 'requests':
      return loadInventoryRequests(query);
    case 'movements':
      return loadInventoryMovements(query);
    case 'lendings':
      return loadInventoryLendings(query);
    case 'serialUnits':
      return current.scopeId ? loadInventorySerialUnits({ ...query, articleId: current.scopeId }) : null;
  }
}

/** Collects reload requests for 250 ms (bursts of live events) and reloads each open slice once. */
export const reloadInventorySlices$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store)) => {
    const reloads$ = actions$.pipe(ofType(reloadInventorySlices));

    return reloads$.pipe(
      buffer(reloads$.pipe(debounceTime(250))),
      withLatestFrom(store.select(selectInventoryState)),
      mergeMap(([batches, state]) => {
        const slices = [...new Set(batches.flatMap((batch) => batch.slices))];

        return from(
          slices
            .map((slice) => reloadActionFor(slice, state))
            .filter((action): action is NonNullable<typeof action> => action !== null),
        );
      }),
    );
  },
  { functional: true },
);

function runMutation(service: AdminInventoryService, mutation: InventoryMutation): Observable<unknown> {
  switch (mutation.kind) {
    case 'saveWarehouse':
      return mutation.id ? service.updateWarehouse(mutation.id, mutation.dto) : service.createWarehouse(mutation.dto);
    case 'deleteWarehouse':
      return service.deleteWarehouse(mutation.id);
    case 'saveCompartment':
      return mutation.id
        ? service.updateCompartment(mutation.id, mutation.dto)
        : service.createCompartment(mutation.warehouseId, mutation.dto);
    case 'deleteCompartment':
      return service.deleteCompartment(mutation.id);
    case 'saveArticle':
      return mutation.id ? service.updateArticle(mutation.id, mutation.dto) : service.createArticle(mutation.dto);
    case 'deleteArticle':
      return service.deleteArticle(mutation.id);
    case 'createPlacement':
      return service.createPlacement(mutation.articleId, mutation.compartmentId);
    case 'deletePlacement':
      return service.deletePlacement(mutation.id);
    case 'putaway':
      return service.putaway(mutation.dto);
    case 'transfer':
      return service.transfer(mutation.dto);
    case 'withdraw':
      return service.withdraw(mutation.dto);
    case 'acceptRequest':
      return service.acceptRequest(mutation.id, mutation.allocations, mutation.note);
    case 'rejectRequest':
      return service.rejectRequest(mutation.id, mutation.note);
    case 'lend':
      return service.lend(mutation.dto);
    case 'returnLending':
      return service.returnLending(mutation.id, mutation.dto);
  }
}

/** Slices a mutation can change (reloaded even without a live socket). */
export const INVENTORY_MUTATION_SLICES: Record<InventoryMutation['kind'], InventorySliceKey[]> = (() => {
  const stock: InventorySliceKey[] = [
    'articleStock',
    'compartmentStock',
    'compartments',
    'warehouses',
    'articles',
    'movements',
    'serialUnits',
  ];

  return {
    saveWarehouse: ['warehouses', 'compartments'],
    deleteWarehouse: ['warehouses'],
    saveCompartment: ['compartments', 'warehouses'],
    deleteCompartment: ['compartments', 'warehouses'],
    saveArticle: ['articles', 'articleStock', 'compartmentStock', 'compartments', 'warehouses'],
    deleteArticle: ['articles'],
    createPlacement: ['articleStock', 'compartmentStock', 'compartments', 'articles'],
    deletePlacement: ['articleStock', 'compartmentStock', 'compartments', 'articles'],
    putaway: stock,
    transfer: stock,
    withdraw: stock,
    acceptRequest: ['requests', ...stock],
    rejectRequest: ['requests', 'articles'],
    lend: ['lendings', ...stock],
    returnLending: ['lendings', ...stock],
  };
})();

/** Mutations run one after another (a second click never overtakes the first). */
export const runInventoryMutation$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminInventoryService)) =>
    actions$.pipe(
      ofType(runInventoryMutation),
      concatMap(({ mutation }) =>
        runMutation(service, mutation).pipe(
          mergeMap((result) =>
            from([
              runInventoryMutationSuccess({ kind: mutation.kind, result: result ?? null }),
              reloadInventorySlices({ slices: INVENTORY_MUTATION_SLICES[mutation.kind] }),
              loadInventorySummary(),
            ]),
          ),
          catchError((error) =>
            of(runInventoryMutationFailure({ kind: mutation.kind, error: normalizeInventoryError(error) })),
          ),
        ),
      ),
    ),
  { functional: true },
);

/** Keeps an open article detail current after its own mutations. */
export const refreshSelectedInventoryArticle$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store)) =>
    actions$.pipe(
      ofType(runInventoryMutationSuccess),
      withLatestFrom(store.select(selectInventoryState)),
      filter(([{ kind }, state]) => Boolean(state.selectedArticle) && kind !== 'deleteArticle'),
      map(([, state]) => loadInventoryArticle({ articleId: state.selectedArticle!.id })),
    ),
  { functional: true },
);
