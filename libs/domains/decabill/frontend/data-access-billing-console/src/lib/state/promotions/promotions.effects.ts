import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, map, of, switchMap } from 'rxjs';

import { billingPageWindow } from '../../constants/list-paging.constants';
import { PromotionsService } from '../../services/promotions.service';

import {
  loadActivePromotions,
  loadActivePromotionsFailure,
  loadActivePromotionsSuccess,
  loadPromotionRedemptions,
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

export const loadActivePromotions$ = createEffect(
  (actions$ = inject(Actions), service = inject(PromotionsService)) =>
    actions$.pipe(
      ofType(loadActivePromotions),
      switchMap(({ search, page, pageSize }) => {
        const { limit, offset } = billingPageWindow(page, pageSize);

        return service.listActive({ limit, offset, search }).pipe(
          map((response) => loadActivePromotionsSuccess({ items: response.items, total: response.total })),
          catchError((error) => of(loadActivePromotionsFailure({ error: normalizeError(error) }))),
        );
      }),
    ),
  { functional: true },
);

export const loadPromotionRedemptions$ = createEffect(
  (actions$ = inject(Actions), service = inject(PromotionsService)) =>
    actions$.pipe(
      ofType(loadPromotionRedemptions),
      switchMap(({ search, page, pageSize }) => {
        const { limit, offset } = billingPageWindow(page, pageSize);

        return service.listRedemptions({ limit, offset, search }).pipe(
          map((response) => loadPromotionRedemptionsSuccess({ items: response.items, total: response.total })),
          catchError((error) => of(loadPromotionRedemptionsFailure({ error: normalizeError(error) }))),
        );
      }),
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
