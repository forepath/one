import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, concatMap, debounceTime, EMPTY, filter, map, mergeMap, of, switchMap } from 'rxjs';

import { GlobalSearchService } from '../../services/global-search.service';
import { apiErrorMessage } from '../../utils/api-error';
import {
  globalSearch,
  globalSearchFailure,
  globalSearchSuccess,
  loadSearchFavourites,
  loadSearchFavouritesFailure,
  loadSearchFavouritesSuccess,
  recordSearchVisit,
  runSearchAction,
  runSearchActionFailure,
  runSearchActionSuccess,
  setSearchFavourite,
  setSearchFavouriteFailure,
  setSearchFavouriteSuccess,
} from './search.actions';

/** Typing in the palette: only the last query of a burst is sent. */
export const SEARCH_DEBOUNCE_MS = 150;

export const globalSearch$ = createEffect(
  (actions$ = inject(Actions), service = inject(GlobalSearchService), debounceMs = SEARCH_DEBOUNCE_MS) =>
    actions$.pipe(
      ofType(globalSearch),
      debounceTime(debounceMs),
      switchMap(({ q, limit }) =>
        q.trim()
          ? service.search(q.trim(), limit).pipe(
              map((response) => globalSearchSuccess({ q, response })),
              catchError((error: unknown) =>
                of(globalSearchFailure({ q, error: apiErrorMessage(error, 'Search failed') })),
              ),
            )
          : EMPTY,
      ),
    ),
  { functional: true },
);

export const loadSearchFavourites$ = createEffect(
  (actions$ = inject(Actions), service = inject(GlobalSearchService)) =>
    actions$.pipe(
      ofType(loadSearchFavourites),
      switchMap(() =>
        service.favourites().pipe(
          map((items) => loadSearchFavouritesSuccess({ items })),
          catchError((error: unknown) =>
            of(loadSearchFavouritesFailure({ error: apiErrorMessage(error, 'Failed to load favourites') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const setSearchFavourite$ = createEffect(
  (actions$ = inject(Actions), service = inject(GlobalSearchService)) =>
    actions$.pipe(
      ofType(setSearchFavourite),
      concatMap(({ item, favourite }) =>
        service.setFavourite(item, favourite).pipe(
          map(() => setSearchFavouriteSuccess({ item, favourite })),
          catchError((error: unknown) =>
            of(
              setSearchFavouriteFailure({
                item,
                favourite,
                error: apiErrorMessage(error, 'Failed to change the favourite'),
              }),
            ),
          ),
        ),
      ),
    ),
  { functional: true },
);

/** Visits are best effort: a failure only loses the ranking boost. */
export const recordSearchVisit$ = createEffect(
  (actions$ = inject(Actions), service = inject(GlobalSearchService)) =>
    actions$.pipe(
      ofType(recordSearchVisit),
      mergeMap(({ result }) => service.visited(result.id).pipe(catchError(() => EMPTY))),
    ),
  { functional: true, dispatch: false },
);

export const runSearchAction$ = createEffect(
  (actions$ = inject(Actions), service = inject(GlobalSearchService)) =>
    actions$.pipe(
      ofType(runSearchAction),
      filter(({ action }) => action.kind === 'api' && !!action.request),
      concatMap(({ action }) =>
        service.runAction(action).pipe(
          map(() => runSearchActionSuccess({ action })),
          catchError((error: unknown) =>
            of(runSearchActionFailure({ action, error: apiErrorMessage(error, 'The action failed') })),
          ),
        ),
      ),
    ),
  { functional: true },
);
