import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, map, of, switchMap } from 'rxjs';

import { PromotionsService } from '../../services/promotions.service';

import {
  loadActivePromotions,
  loadActivePromotionsBatch,
  loadActivePromotionsFailure,
  loadActivePromotionsSuccess,
  loadPromotionRedemptions,
  loadPromotionRedemptionsBatch,
  loadPromotionRedemptionsFailure,
  loadPromotionRedemptionsSuccess,
  redeemPromotion,
  redeemPromotionFailure,
  redeemPromotionSuccess,
  validatePromotion,
  validatePromotionFailure,
  validatePromotionSuccess,
} from './promotions.actions';

function normalizeError(error: unknown): string {
  if (error instanceof Error) return error.message;

  if (typeof error === 'string') return error;

  if (error && typeof error === 'object' && 'message' in error) return String(error.message);

  return 'An unexpected error occurred';
}

const BATCH_SIZE = 10;

export const loadActivePromotions$ = createEffect(
  (actions$ = inject(Actions), service = inject(PromotionsService)) =>
    actions$.pipe(
      ofType(loadActivePromotions),
      switchMap(() =>
        service.listActive({ limit: BATCH_SIZE, offset: 0 }).pipe(
          switchMap((response) => {
            if (response.items.length === 0) {
              return of(loadActivePromotionsSuccess({ items: [] }));
            }

            if (response.items.length < BATCH_SIZE) {
              return of(loadActivePromotionsSuccess({ items: response.items }));
            }

            return of(loadActivePromotionsBatch({ offset: BATCH_SIZE, accumulated: response.items }));
          }),
          catchError((error) => of(loadActivePromotionsFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const loadActivePromotionsBatch$ = createEffect(
  (actions$ = inject(Actions), service = inject(PromotionsService)) =>
    actions$.pipe(
      ofType(loadActivePromotionsBatch),
      switchMap(({ offset, accumulated }) =>
        service.listActive({ limit: BATCH_SIZE, offset }).pipe(
          switchMap((response) => {
            const newAccumulated = [...accumulated, ...response.items];

            if (response.items.length === 0 || response.items.length < BATCH_SIZE) {
              return of(loadActivePromotionsSuccess({ items: newAccumulated }));
            }

            return of(
              loadActivePromotionsBatch({
                offset: offset + BATCH_SIZE,
                accumulated: newAccumulated,
              }),
            );
          }),
          catchError((error) => of(loadActivePromotionsFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const loadPromotionRedemptions$ = createEffect(
  (actions$ = inject(Actions), service = inject(PromotionsService)) =>
    actions$.pipe(
      ofType(loadPromotionRedemptions),
      switchMap(() =>
        service.listRedemptions({ limit: BATCH_SIZE, offset: 0 }).pipe(
          switchMap((response) => {
            if (response.items.length === 0) {
              return of(loadPromotionRedemptionsSuccess({ items: [] }));
            }

            if (response.items.length < BATCH_SIZE) {
              return of(loadPromotionRedemptionsSuccess({ items: response.items }));
            }

            return of(loadPromotionRedemptionsBatch({ offset: BATCH_SIZE, accumulated: response.items }));
          }),
          catchError((error) => of(loadPromotionRedemptionsFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const loadPromotionRedemptionsBatch$ = createEffect(
  (actions$ = inject(Actions), service = inject(PromotionsService)) =>
    actions$.pipe(
      ofType(loadPromotionRedemptionsBatch),
      switchMap(({ offset, accumulated }) =>
        service.listRedemptions({ limit: BATCH_SIZE, offset }).pipe(
          switchMap((response) => {
            const newAccumulated = [...accumulated, ...response.items];

            if (response.items.length === 0 || response.items.length < BATCH_SIZE) {
              return of(loadPromotionRedemptionsSuccess({ items: newAccumulated }));
            }

            return of(
              loadPromotionRedemptionsBatch({
                offset: offset + BATCH_SIZE,
                accumulated: newAccumulated,
              }),
            );
          }),
          catchError((error) => of(loadPromotionRedemptionsFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const validatePromotion$ = createEffect(
  (actions$ = inject(Actions), service = inject(PromotionsService)) =>
    actions$.pipe(
      ofType(validatePromotion),
      switchMap(({ request }) =>
        service.validate(request).pipe(
          map((preview) => validatePromotionSuccess({ request, preview })),
          catchError((error) => of(validatePromotionFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const redeemPromotion$ = createEffect(
  (actions$ = inject(Actions), service = inject(PromotionsService)) =>
    actions$.pipe(
      ofType(redeemPromotion),
      switchMap(({ request }) =>
        service.redeem(request).pipe(
          map((redemption) => redeemPromotionSuccess({ redemption })),
          catchError((error) => of(redeemPromotionFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);
