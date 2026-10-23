import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, map, of, switchMap } from 'rxjs';

import { AdminBillingService } from '../../services/admin-billing.service';

import {
  loadAdminSubscriptions,
  loadAdminSubscriptionsFailure,
  loadAdminSubscriptionsSuccess,
  loadMoreAdminSubscriptions,
  loadMoreAdminSubscriptionsFailure,
  loadMoreAdminSubscriptionsSuccess,
  adminCancelSubscription,
  adminCancelSubscriptionFailure,
  adminCancelSubscriptionSuccess,
  adminWithdrawSubscription,
  adminWithdrawSubscriptionFailure,
  adminWithdrawSubscriptionSuccess,
  adminInstantCancelSubscription,
  adminInstantCancelSubscriptionFailure,
  adminInstantCancelSubscriptionSuccess,
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
          map((response) => {
            const nextOffset = response.items.length;

            return loadAdminSubscriptionsSuccess({
              subscriptions: response.items,
              hasMore: nextOffset < response.total,
              nextOffset,
            });
          }),
          catchError((error) => of(loadAdminSubscriptionsFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const loadMoreAdminSubscriptions$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminBillingService)) =>
    actions$.pipe(
      ofType(loadMoreAdminSubscriptions),
      switchMap(({ offset, search, userId }) =>
        service.listSubscriptions({ limit: BATCH_SIZE, offset, search, userId }).pipe(
          map((response) => {
            const nextOffset = offset + response.items.length;

            return loadMoreAdminSubscriptionsSuccess({
              subscriptions: response.items,
              hasMore: nextOffset < response.total,
              nextOffset,
            });
          }),
          catchError((error) => of(loadMoreAdminSubscriptionsFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const adminCancelSubscription$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminBillingService)) =>
    actions$.pipe(
      ofType(adminCancelSubscription),
      switchMap(({ id, options }) =>
        service.cancelSubscription(id, options).pipe(
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
      switchMap(({ id, options }) =>
        service.withdrawSubscription(id, options).pipe(
          map((subscription) => adminWithdrawSubscriptionSuccess({ subscription })),
          catchError((error) => of(adminWithdrawSubscriptionFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const adminInstantCancelSubscription$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminBillingService)) =>
    actions$.pipe(
      ofType(adminInstantCancelSubscription),
      switchMap(({ id, options }) =>
        service.instantCancelSubscription(id, options).pipe(
          map((subscription) => adminInstantCancelSubscriptionSuccess({ subscription })),
          catchError((error) => of(adminInstantCancelSubscriptionFailure({ error: normalizeError(error) }))),
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
