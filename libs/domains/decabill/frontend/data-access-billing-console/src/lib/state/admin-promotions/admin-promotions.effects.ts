import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, map, of, switchMap } from 'rxjs';

import { billingPageWindow } from '../../constants/list-paging.constants';
import { AdminPromotionsService } from '../../services/admin-promotions.service';

import {
  createAdminPromotion,
  createAdminPromotionFailure,
  createAdminPromotionSuccess,
  deactivateAdminPromotion,
  deactivateAdminPromotionFailure,
  deactivateAdminPromotionSuccess,
  loadAdminPromotionRedemptions,
  loadAdminPromotionRedemptionsFailure,
  loadAdminPromotionRedemptionsSuccess,
  loadAdminPromotions,
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

export const loadAdminPromotions$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminPromotionsService)) =>
    actions$.pipe(
      ofType(loadAdminPromotions),
      switchMap(({ search, page, pageSize }) => {
        const { limit, offset } = billingPageWindow(page, pageSize);

        return service.list({ limit, offset, search }).pipe(
          map((response) => loadAdminPromotionsSuccess({ promotions: response.items, total: response.total })),
          catchError((error) => of(loadAdminPromotionsFailure({ error: normalizeError(error) }))),
        );
      }),
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
      switchMap(({ promotionId, page, pageSize }) => {
        const { limit, offset } = billingPageWindow(page, pageSize);

        return service.listRedemptions(promotionId, { limit, offset }).pipe(
          map((response) =>
            loadAdminPromotionRedemptionsSuccess({ redemptions: response.items, total: response.total }),
          ),
          catchError((error) => of(loadAdminPromotionRedemptionsFailure({ error: normalizeError(error) }))),
        );
      }),
    ),
  { functional: true },
);
