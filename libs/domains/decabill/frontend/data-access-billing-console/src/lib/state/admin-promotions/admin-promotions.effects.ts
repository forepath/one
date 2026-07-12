import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, map, of, switchMap } from 'rxjs';

import { AdminPromotionsService } from '../../services/admin-promotions.service';

import {
  createAdminPromotion,
  createAdminPromotionFailure,
  createAdminPromotionSuccess,
  deactivateAdminPromotion,
  deactivateAdminPromotionFailure,
  deactivateAdminPromotionSuccess,
  loadAdminPromotionRedemptions,
  loadAdminPromotionRedemptionsBatch,
  loadAdminPromotionRedemptionsFailure,
  loadAdminPromotionRedemptionsSuccess,
  loadAdminPromotions,
  loadAdminPromotionsBatch,
  loadAdminPromotionsFailure,
  loadAdminPromotionsSuccess,
  updateAdminPromotion,
  updateAdminPromotionFailure,
  updateAdminPromotionSuccess,
} from './admin-promotions.actions';

function normalizeError(error: unknown): string {
  if (error instanceof Error) return error.message;

  if (typeof error === 'string') return error;

  if (error && typeof error === 'object' && 'message' in error) return String(error.message);

  return 'An unexpected error occurred';
}

const BATCH_SIZE = 10;

export const loadAdminPromotions$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminPromotionsService)) =>
    actions$.pipe(
      ofType(loadAdminPromotions),
      switchMap(() =>
        service.list({ limit: BATCH_SIZE, offset: 0 }).pipe(
          switchMap((response) => {
            if (response.items.length === 0) {
              return of(loadAdminPromotionsSuccess({ promotions: [] }));
            }

            if (response.items.length < BATCH_SIZE) {
              return of(loadAdminPromotionsSuccess({ promotions: response.items }));
            }

            return of(loadAdminPromotionsBatch({ offset: BATCH_SIZE, accumulated: response.items }));
          }),
          catchError((error) => of(loadAdminPromotionsFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const loadAdminPromotionsBatch$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminPromotionsService)) =>
    actions$.pipe(
      ofType(loadAdminPromotionsBatch),
      switchMap(({ offset, accumulated }) =>
        service.list({ limit: BATCH_SIZE, offset }).pipe(
          switchMap((response) => {
            const newAccumulated = [...accumulated, ...response.items];

            if (response.items.length === 0 || response.items.length < BATCH_SIZE) {
              return of(loadAdminPromotionsSuccess({ promotions: newAccumulated }));
            }

            return of(
              loadAdminPromotionsBatch({
                offset: offset + BATCH_SIZE,
                accumulated: newAccumulated,
              }),
            );
          }),
          catchError((error) => of(loadAdminPromotionsFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const createAdminPromotion$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminPromotionsService)) =>
    actions$.pipe(
      ofType(createAdminPromotion),
      switchMap(({ dto }) =>
        service.create(dto).pipe(
          map((promotion) => createAdminPromotionSuccess({ promotion })),
          catchError((error) => of(createAdminPromotionFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const updateAdminPromotion$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminPromotionsService)) =>
    actions$.pipe(
      ofType(updateAdminPromotion),
      switchMap(({ id, dto }) =>
        service.update(id, dto).pipe(
          map((promotion) => updateAdminPromotionSuccess({ promotion })),
          catchError((error) => of(updateAdminPromotionFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const deactivateAdminPromotion$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminPromotionsService)) =>
    actions$.pipe(
      ofType(deactivateAdminPromotion),
      switchMap(({ id }) =>
        service.deactivate(id).pipe(
          map((promotion) => deactivateAdminPromotionSuccess({ promotion })),
          catchError((error) => of(deactivateAdminPromotionFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const loadAdminPromotionRedemptions$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminPromotionsService)) =>
    actions$.pipe(
      ofType(loadAdminPromotionRedemptions),
      switchMap(({ promotionId }) =>
        service.listRedemptions(promotionId, { limit: BATCH_SIZE, offset: 0 }).pipe(
          switchMap((response) => {
            if (response.items.length === 0) {
              return of(loadAdminPromotionRedemptionsSuccess({ redemptions: [] }));
            }

            if (response.items.length < BATCH_SIZE) {
              return of(loadAdminPromotionRedemptionsSuccess({ redemptions: response.items }));
            }

            return of(
              loadAdminPromotionRedemptionsBatch({
                promotionId,
                offset: BATCH_SIZE,
                accumulated: response.items,
              }),
            );
          }),
          catchError((error) => of(loadAdminPromotionRedemptionsFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const loadAdminPromotionRedemptionsBatch$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminPromotionsService)) =>
    actions$.pipe(
      ofType(loadAdminPromotionRedemptionsBatch),
      switchMap(({ promotionId, offset, accumulated }) =>
        service.listRedemptions(promotionId, { limit: BATCH_SIZE, offset }).pipe(
          switchMap((response) => {
            const newAccumulated = [...accumulated, ...response.items];

            if (response.items.length === 0 || response.items.length < BATCH_SIZE) {
              return of(loadAdminPromotionRedemptionsSuccess({ redemptions: newAccumulated }));
            }

            return of(
              loadAdminPromotionRedemptionsBatch({
                promotionId,
                offset: offset + BATCH_SIZE,
                accumulated: newAccumulated,
              }),
            );
          }),
          catchError((error) => of(loadAdminPromotionRedemptionsFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);
