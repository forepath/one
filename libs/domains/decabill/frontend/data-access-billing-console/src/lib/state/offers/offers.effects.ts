import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, map, mergeMap, of, switchMap } from 'rxjs';

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
      switchMap(({ search }) =>
        offersService.getPendingOffers(search).pipe(
          map((offers) => loadPendingOffersSuccess({ offers })),
          catchError((error) => of(loadPendingOffersFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const loadHistoryOffers$ = createEffect(
  (actions$ = inject(Actions), offersService = inject(OffersService)) =>
    actions$.pipe(
      ofType(loadHistoryOffers),
      switchMap(({ search }) =>
        offersService.getHistoryOffers(search).pipe(
          map((offers) => loadHistoryOffersSuccess({ offers })),
          catchError((error) => of(loadHistoryOffersFailure({ error: normalizeError(error) }))),
        ),
      ),
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

export const reloadOffersAfterResponse$ = createEffect(
  (actions$ = inject(Actions)) =>
    actions$.pipe(
      ofType(acceptOfferSuccess, declineOfferSuccess),
      mergeMap(() => [loadOffersSummary(), loadPendingOffers({}), loadHistoryOffers({})]),
    ),
  { functional: true },
);
