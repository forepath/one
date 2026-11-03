import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, map, of, switchMap } from 'rxjs';

import { BILLING_LIST_PAGE_SIZE } from '../../constants/list-paging.constants';
import { SubscriptionsService } from '../../services/subscriptions.service';
import { cancelBackorderSuccess, retryBackorderSuccess } from '../backorders/backorders.actions';

import {
  cancelSubscription,
  cancelSubscriptionFailure,
  cancelSubscriptionSuccess,
  createSubscription,
  createSubscriptionFailure,
  createSubscriptionSuccess,
  loadSubscription,
  loadSubscriptionFailure,
  loadSubscriptions,
  loadSubscriptionsFailure,
  loadSubscriptionsSuccess,
  loadSubscriptionSuccess,
  loadSubscriptionsSummary,
  loadSubscriptionsSummaryFailure,
  loadSubscriptionsSummarySuccess,
  resumeSubscription,
  resumeSubscriptionFailure,
  resumeSubscriptionSuccess,
  withdrawSubscription,
  withdrawSubscriptionFailure,
  withdrawSubscriptionSuccess,
} from './subscriptions.actions';

function normalizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  if (error && typeof error === 'object' && 'message' in error) {
    return String(error.message);
  }

  return 'An unexpected error occurred';
}

export const loadSubscriptionsSummary$ = createEffect(
  (actions$ = inject(Actions), subscriptionsService = inject(SubscriptionsService)) => {
    return actions$.pipe(
      ofType(loadSubscriptionsSummary),
      switchMap(() =>
        subscriptionsService.getSubscriptionsSummary().pipe(
          map((summary) => loadSubscriptionsSummarySuccess({ summary })),
          catchError((error) => of(loadSubscriptionsSummaryFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

/**
 * One page of the customer's subscriptions (replace-page). The API returns a plain array without a total: one extra
 * row is requested to tell whether a next page exists.
 */
export const loadSubscriptions$ = createEffect(
  (actions$ = inject(Actions), subscriptionsService = inject(SubscriptionsService)) => {
    return actions$.pipe(
      ofType(loadSubscriptions),
      switchMap(({ params }) => {
        const limit = params?.limit && params.limit > 0 ? params.limit : BILLING_LIST_PAGE_SIZE;
        const pageParams = { ...params, limit: limit + 1, offset: params?.offset ?? 0 };

        return subscriptionsService.listSubscriptions(pageParams).pipe(
          map((subscriptions) =>
            loadSubscriptionsSuccess({
              subscriptions: subscriptions.slice(0, limit),
              hasMore: subscriptions.length > limit,
            }),
          ),
          catchError((error) => of(loadSubscriptionsFailure({ error: normalizeError(error) }))),
        );
      }),
    );
  },
  { functional: true },
);

export const loadSubscription$ = createEffect(
  (actions$ = inject(Actions), subscriptionsService = inject(SubscriptionsService)) => {
    return actions$.pipe(
      ofType(loadSubscription),
      switchMap(({ id }) =>
        subscriptionsService.getSubscription(id).pipe(
          map((subscription) => loadSubscriptionSuccess({ subscription })),
          catchError((error) => of(loadSubscriptionFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const createSubscription$ = createEffect(
  (actions$ = inject(Actions), subscriptionsService = inject(SubscriptionsService)) => {
    return actions$.pipe(
      ofType(createSubscription),
      switchMap(({ subscription }) =>
        subscriptionsService.createSubscription(subscription).pipe(
          map((createdSubscription) => createSubscriptionSuccess({ subscription: createdSubscription })),
          catchError((error) => of(createSubscriptionFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const reloadSubscriptionsSummaryAfterMutation$ = createEffect(
  (actions$ = inject(Actions)) => {
    return actions$.pipe(
      ofType(
        createSubscriptionSuccess,
        cancelSubscriptionSuccess,
        withdrawSubscriptionSuccess,
        resumeSubscriptionSuccess,
        retryBackorderSuccess,
        cancelBackorderSuccess,
      ),
      map(() => loadSubscriptionsSummary()),
    );
  },
  { functional: true },
);

export const cancelSubscription$ = createEffect(
  (actions$ = inject(Actions), subscriptionsService = inject(SubscriptionsService)) => {
    return actions$.pipe(
      ofType(cancelSubscription),
      switchMap(({ id, dto }) =>
        subscriptionsService.cancelSubscription(id, dto).pipe(
          map((subscription) => cancelSubscriptionSuccess({ subscription })),
          catchError((error) => of(cancelSubscriptionFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const withdrawSubscription$ = createEffect(
  (actions$ = inject(Actions), subscriptionsService = inject(SubscriptionsService)) => {
    return actions$.pipe(
      ofType(withdrawSubscription),
      switchMap(({ id, dto }) =>
        subscriptionsService.withdrawSubscription(id, dto).pipe(
          map((subscription) => withdrawSubscriptionSuccess({ subscription })),
          catchError((error) => of(withdrawSubscriptionFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const resumeSubscription$ = createEffect(
  (actions$ = inject(Actions), subscriptionsService = inject(SubscriptionsService)) => {
    return actions$.pipe(
      ofType(resumeSubscription),
      switchMap(({ id, dto }) =>
        subscriptionsService.resumeSubscription(id, dto).pipe(
          map((subscription) => resumeSubscriptionSuccess({ subscription })),
          catchError((error) => of(resumeSubscriptionFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);
