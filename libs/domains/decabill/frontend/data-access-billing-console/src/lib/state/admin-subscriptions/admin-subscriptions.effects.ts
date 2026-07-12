import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, map, of, switchMap } from 'rxjs';

import { AdminBillingService } from '../../services/admin-billing.service';

import {
  loadAdminSubscriptions,
  loadAdminSubscriptionsBatch,
  loadAdminSubscriptionsFailure,
  loadAdminSubscriptionsSuccess,
  adminCancelSubscription,
  adminCancelSubscriptionFailure,
  adminCancelSubscriptionSuccess,
  adminWithdrawSubscription,
  adminWithdrawSubscriptionFailure,
  adminWithdrawSubscriptionSuccess,
  adminResumeSubscription,
  adminResumeSubscriptionFailure,
  adminResumeSubscriptionSuccess,
} from './admin-subscriptions.actions';

function normalizeError(error: unknown): string {
  if (error instanceof Error) return error.message;

  if (typeof error === 'string') return error;

  if (error && typeof error === 'object' && 'message' in error) return String(error.message);

  return 'An unexpected error occurred';
}

const BATCH_SIZE = 10;

export const loadAdminSubscriptions$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminBillingService)) =>
    actions$.pipe(
      ofType(loadAdminSubscriptions),
      switchMap(({ search, userId }) =>
        service.listSubscriptions({ limit: BATCH_SIZE, offset: 0, search, userId }).pipe(
          switchMap((response) => {
            if (response.items.length === 0) {
              return of(loadAdminSubscriptionsSuccess({ subscriptions: [] }));
            }

            if (response.items.length < BATCH_SIZE || response.items.length >= response.total) {
              return of(loadAdminSubscriptionsSuccess({ subscriptions: response.items }));
            }

            return of(
              loadAdminSubscriptionsBatch({
                offset: BATCH_SIZE,
                accumulatedSubscriptions: response.items,
                search,
                userId,
              }),
            );
          }),
          catchError((error) => of(loadAdminSubscriptionsFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const loadAdminSubscriptionsBatch$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminBillingService)) =>
    actions$.pipe(
      ofType(loadAdminSubscriptionsBatch),
      switchMap(({ offset, accumulatedSubscriptions, search, userId }) =>
        service.listSubscriptions({ limit: BATCH_SIZE, offset, search, userId }).pipe(
          switchMap((response) => {
            const newAccumulated = [...accumulatedSubscriptions, ...response.items];

            if (response.items.length === 0 || response.items.length < BATCH_SIZE) {
              return of(loadAdminSubscriptionsSuccess({ subscriptions: newAccumulated }));
            }

            return of(
              loadAdminSubscriptionsBatch({
                offset: offset + BATCH_SIZE,
                accumulatedSubscriptions: newAccumulated,
                search,
                userId,
              }),
            );
          }),
          catchError((error) => of(loadAdminSubscriptionsFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const adminCancelSubscription$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminBillingService)) =>
    actions$.pipe(
      ofType(adminCancelSubscription),
      switchMap(({ id }) =>
        service.cancelSubscription(id).pipe(
          map((subscription) => adminCancelSubscriptionSuccess({ subscription })),
          catchError((error) => of(adminCancelSubscriptionFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const adminWithdrawSubscription$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminBillingService)) =>
    actions$.pipe(
      ofType(adminWithdrawSubscription),
      switchMap(({ id }) =>
        service.withdrawSubscription(id).pipe(
          map((subscription) => adminWithdrawSubscriptionSuccess({ subscription })),
          catchError((error) => of(adminWithdrawSubscriptionFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const adminResumeSubscription$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminBillingService)) =>
    actions$.pipe(
      ofType(adminResumeSubscription),
      switchMap(({ id }) =>
        service.resumeSubscription(id).pipe(
          map((subscription) => adminResumeSubscriptionSuccess({ subscription })),
          catchError((error) => of(adminResumeSubscriptionFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);
