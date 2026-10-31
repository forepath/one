import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { catchError, map, mergeMap, of, switchMap, take } from 'rxjs';

import { billingPageWindow } from '../../constants/list-paging.constants';
import { OffersService } from '../../services/offers.service';

import {
  acceptOffer,
  acceptOfferFailure,
  acceptOfferSuccess,
  declineOffer,
  declineOfferFailure,
  declineOfferSuccess,
  loadHistoryOffers,
  loadHistoryOffersFailure,
  loadHistoryOffersSuccess,
  loadOfferDetails,
  loadOfferDetailsFailure,
  loadOfferDetailsSuccess,
  loadOffersSummary,
  loadOffersSummaryFailure,
  loadOffersSummarySuccess,
  loadPendingOffers,
  loadPendingOffersFailure,
  loadPendingOffersSuccess,
} from './offers.actions';
import { selectOffersState } from './offers.selectors';

function normalizeError(error: unknown): string {
  if (error instanceof Error) return error.message;

  if (typeof error === 'string') return error;

  if (error && typeof error === 'object' && 'message' in error) return String(error.message);

  return 'An unexpected error occurred';
}

export const loadOffersSummary$ = createEffect(
  (actions$ = inject(Actions), offersService = inject(OffersService)) =>
    actions$.pipe(
      ofType(loadOffersSummary),
      switchMap(() =>
        offersService.getSummary().pipe(
          map((summary) => loadOffersSummarySuccess({ summary })),
          catchError((error) => of(loadOffersSummaryFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const loadPendingOffers$ = createEffect(
  (actions$ = inject(Actions), offersService = inject(OffersService)) =>
    actions$.pipe(
      ofType(loadPendingOffers),
      switchMap(({ search, page, pageSize }) => {
        const { limit, offset } = billingPageWindow(page, pageSize);

        return offersService.getPendingOffers({ search, limit, offset }).pipe(
          map((response) => loadPendingOffersSuccess({ offers: response.items, total: response.total })),
          catchError((error) => of(loadPendingOffersFailure({ error: normalizeError(error) }))),
        );
      }),
    ),
  { functional: true },
);

export const loadHistoryOffers$ = createEffect(
  (actions$ = inject(Actions), offersService = inject(OffersService)) =>
    actions$.pipe(
      ofType(loadHistoryOffers),
      switchMap(({ search, page, pageSize }) => {
        const { limit, offset } = billingPageWindow(page, pageSize);

        return offersService.getHistoryOffers({ search, limit, offset }).pipe(
          map((response) => loadHistoryOffersSuccess({ offers: response.items, total: response.total })),
          catchError((error) => of(loadHistoryOffersFailure({ error: normalizeError(error) }))),
        );
      }),
    ),
  { functional: true },
);

export const loadOfferDetails$ = createEffect(
  (actions$ = inject(Actions), offersService = inject(OffersService)) =>
    actions$.pipe(
      ofType(loadOfferDetails),
      switchMap(({ offerId }) =>
        offersService.getOffer(offerId).pipe(
          map((detail) => loadOfferDetailsSuccess({ offerId, detail })),
          catchError((error) => of(loadOfferDetailsFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const acceptOffer$ = createEffect(
  (actions$ = inject(Actions), offersService = inject(OffersService)) =>
    actions$.pipe(
      ofType(acceptOffer),
      switchMap(({ offerId }) =>
        offersService.acceptOffer(offerId).pipe(
          map((offer) => acceptOfferSuccess({ offer })),
          catchError((error) => of(acceptOfferFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const declineOffer$ = createEffect(
  (actions$ = inject(Actions), offersService = inject(OffersService)) =>
    actions$.pipe(
      ofType(declineOffer),
      switchMap(({ offerId }) =>
        offersService.declineOffer(offerId).pipe(
          map((offer) => declineOfferSuccess({ offer })),
          catchError((error) => of(declineOfferFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

/** After accept / decline: summary + the current page (search, page, size) of both lists (replace-page). */
export const reloadOffersAfterResponse$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store)) =>
    actions$.pipe(
      ofType(acceptOfferSuccess, declineOfferSuccess),
      switchMap(() => store.select(selectOffersState).pipe(take(1))),
      mergeMap((state) => [
        loadOffersSummary(),
        loadPendingOffers({
          search: state?.pendingSearch ?? undefined,
          page: state?.pendingPage,
          pageSize: state?.pendingPageSize,
        }),
        loadHistoryOffers({
          search: state?.historySearch ?? undefined,
          page: state?.historyPage,
          pageSize: state?.historyPageSize,
        }),
      ]),
    ),
  { functional: true },
);
