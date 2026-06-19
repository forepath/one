import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, map, of, switchMap } from 'rxjs';

import { SubscriptionsService } from '../../services/subscriptions.service';

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
  loadSubscriptionsBatch,
  loadSubscriptionsFailure,
  loadSubscriptionsSuccess,
  loadSubscriptionSuccess,
  resumeSubscription,
  resumeSubscriptionFailure,
  resumeSubscriptionSuccess,
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

const BATCH_SIZE = 10;

export const loadSubscriptions$ = createEffect(
  (actions$ = inject(Actions), subscriptionsService = inject(SubscriptionsService)) => {
    return actions$.pipe(
      ofType(loadSubscriptions),
      switchMap(({ params }) => {
        const batchParams = { limit: BATCH_SIZE, offset: 0, ...params };

        return subscriptionsService.listSubscriptions(batchParams).pipe(
          switchMap((subscriptions) => {
            if (subscriptions.length === 0) {
              return of(loadSubscriptionsSuccess({ subscriptions: [] }));
            }

            if (subscriptions.length < BATCH_SIZE) {
              return of(loadSubscriptionsSuccess({ subscriptions }));
            }

            return of(loadSubscriptionsBatch({ offset: BATCH_SIZE, accumulatedSubscriptions: subscriptions }));
          }),
          catchError((error) => of(loadSubscriptionsFailure({ error: normalizeError(error) }))),
        );
      }),
    );
  },
  { functional: true },
);

export const loadSubscriptionsBatch$ = createEffect(
  (actions$ = inject(Actions), subscriptionsService = inject(SubscriptionsService)) => {
    return actions$.pipe(
      ofType(loadSubscriptionsBatch),
      switchMap(({ offset, accumulatedSubscriptions }) => {
        const batchParams = { limit: BATCH_SIZE, offset };

        return subscriptionsService.listSubscriptions(batchParams).pipe(
          switchMap((subscriptions) => {
            const newAccumulated = [...accumulatedSubscriptions, ...subscriptions];

            if (subscriptions.length === 0) {
              return of(loadSubscriptionsSuccess({ subscriptions: newAccumulated }));
            }

            if (subscriptions.length < BATCH_SIZE) {
              return of(loadSubscriptionsSuccess({ subscriptions: newAccumulated }));
            }

            return of(
              loadSubscriptionsBatch({
                offset: offset + BATCH_SIZE,
                accumulatedSubscriptions: newAccumulated,
              }),
            );
          }),
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
