import { HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, map, of, switchMap } from 'rxjs';

import { ADMIN_WEBHOOKS_BATCH_SIZE } from '../../constants/admin-webhooks.constants';
import { WebhookEndpointsService } from '../../services/webhook-endpoints.service';

import {
  createAdminWebhook,
  createAdminWebhookFailure,
  createAdminWebhookSuccess,
  deleteAdminWebhook,
  deleteAdminWebhookFailure,
  deleteAdminWebhookSuccess,
  loadAdminWebhookDeliveries,
  loadAdminWebhookDeliveriesBatch,
  loadAdminWebhookDeliveriesFailure,
  loadAdminWebhookDeliveriesSuccess,
  loadAdminWebhookEventTypes,
  loadAdminWebhookEventTypesFailure,
  loadAdminWebhookEventTypesSuccess,
  loadAdminWebhooks,
  loadAdminWebhooksBatch,
  loadAdminWebhooksFailure,
  loadAdminWebhooksSuccess,
  testAdminWebhook,
  testAdminWebhookFailure,
  testAdminWebhookSuccess,
  updateAdminWebhook,
  updateAdminWebhookFailure,
  updateAdminWebhookSuccess,
} from './admin-webhooks.actions';

function normalizeError(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    return error.error?.message ?? error.message ?? String(error.status);
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'An unexpected error occurred';
}

export const loadAdminWebhooks$ = createEffect(
  (actions$ = inject(Actions), svc = inject(WebhookEndpointsService)) => {
    return actions$.pipe(
      ofType(loadAdminWebhooks),
      switchMap(() => {
        const batchParams = { limit: ADMIN_WEBHOOKS_BATCH_SIZE, offset: 0 };

        return svc.list(batchParams).pipe(
          switchMap((endpoints) => {
            if (endpoints.length === 0) {
              return of(loadAdminWebhooksSuccess({ endpoints: [] }));
            }

            if (endpoints.length < ADMIN_WEBHOOKS_BATCH_SIZE) {
              return of(loadAdminWebhooksSuccess({ endpoints }));
            }

            return of(loadAdminWebhooksBatch({ offset: ADMIN_WEBHOOKS_BATCH_SIZE, accumulatedEndpoints: endpoints }));
          }),
          catchError((error) => of(loadAdminWebhooksFailure({ error: normalizeError(error) }))),
        );
      }),
    );
  },
  { functional: true },
);

export const loadAdminWebhooksBatch$ = createEffect(
  (actions$ = inject(Actions), svc = inject(WebhookEndpointsService)) => {
    return actions$.pipe(
      ofType(loadAdminWebhooksBatch),
      switchMap(({ offset, accumulatedEndpoints }) => {
        const batchParams = { limit: ADMIN_WEBHOOKS_BATCH_SIZE, offset };

        return svc.list(batchParams).pipe(
          switchMap((endpoints) => {
            const newAccumulated = [...accumulatedEndpoints, ...endpoints];

            if (endpoints.length === 0) {
              return of(loadAdminWebhooksSuccess({ endpoints: newAccumulated }));
            }

            if (endpoints.length < ADMIN_WEBHOOKS_BATCH_SIZE) {
              return of(loadAdminWebhooksSuccess({ endpoints: newAccumulated }));
            }

            return of(
              loadAdminWebhooksBatch({
                offset: offset + ADMIN_WEBHOOKS_BATCH_SIZE,
                accumulatedEndpoints: newAccumulated,
              }),
            );
          }),
          catchError((error) => of(loadAdminWebhooksFailure({ error: normalizeError(error) }))),
        );
      }),
    );
  },
  { functional: true },
);

export const loadAdminWebhookEventTypes$ = createEffect(
  (actions$ = inject(Actions), svc = inject(WebhookEndpointsService)) => {
    return actions$.pipe(
      ofType(loadAdminWebhookEventTypes),
      switchMap(() =>
        svc.listEventTypes().pipe(
          map((eventTypes) => loadAdminWebhookEventTypesSuccess({ eventTypes })),
          catchError((error) => of(loadAdminWebhookEventTypesFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const createAdminWebhook$ = createEffect(
  (actions$ = inject(Actions), svc = inject(WebhookEndpointsService)) => {
    return actions$.pipe(
      ofType(createAdminWebhook),
      switchMap(({ dto }) =>
        svc.create(dto).pipe(
          map((endpoint) => createAdminWebhookSuccess({ endpoint })),
          catchError((error) => of(createAdminWebhookFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const updateAdminWebhook$ = createEffect(
  (actions$ = inject(Actions), svc = inject(WebhookEndpointsService)) => {
    return actions$.pipe(
      ofType(updateAdminWebhook),
      switchMap(({ id, dto }) =>
        svc.update(id, dto).pipe(
          map((endpoint) => updateAdminWebhookSuccess({ endpoint })),
          catchError((error) => of(updateAdminWebhookFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const deleteAdminWebhook$ = createEffect(
  (actions$ = inject(Actions), svc = inject(WebhookEndpointsService)) => {
    return actions$.pipe(
      ofType(deleteAdminWebhook),
      switchMap(({ id }) =>
        svc.delete(id).pipe(
          map(() => deleteAdminWebhookSuccess({ id })),
          catchError((error) => of(deleteAdminWebhookFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const testAdminWebhook$ = createEffect(
  (actions$ = inject(Actions), svc = inject(WebhookEndpointsService)) => {
    return actions$.pipe(
      ofType(testAdminWebhook),
      switchMap(({ id }) =>
        svc.test(id).pipe(
          map((delivery) => testAdminWebhookSuccess({ delivery })),
          catchError((error) => of(testAdminWebhookFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const loadAdminWebhookDeliveries$ = createEffect(
  (actions$ = inject(Actions), svc = inject(WebhookEndpointsService)) => {
    return actions$.pipe(
      ofType(loadAdminWebhookDeliveries),
      switchMap(({ id }) => {
        const batchParams = { limit: ADMIN_WEBHOOKS_BATCH_SIZE, offset: 0 };

        return svc.listDeliveries(id, batchParams).pipe(
          switchMap((response) => {
            if (response.items.length === 0) {
              return of(loadAdminWebhookDeliveriesSuccess({ endpointId: id, deliveries: [], total: response.total }));
            }

            if (response.items.length < ADMIN_WEBHOOKS_BATCH_SIZE || response.items.length >= response.total) {
              return of(
                loadAdminWebhookDeliveriesSuccess({
                  endpointId: id,
                  deliveries: response.items,
                  total: response.total,
                }),
              );
            }

            return of(
              loadAdminWebhookDeliveriesBatch({
                id,
                offset: ADMIN_WEBHOOKS_BATCH_SIZE,
                accumulatedDeliveries: response.items,
                total: response.total,
              }),
            );
          }),
          catchError((error) => of(loadAdminWebhookDeliveriesFailure({ error: normalizeError(error) }))),
        );
      }),
    );
  },
  { functional: true },
);

export const loadAdminWebhookDeliveriesBatch$ = createEffect(
  (actions$ = inject(Actions), svc = inject(WebhookEndpointsService)) => {
    return actions$.pipe(
      ofType(loadAdminWebhookDeliveriesBatch),
      switchMap(({ id, offset, accumulatedDeliveries, total }) => {
        const batchParams = { limit: ADMIN_WEBHOOKS_BATCH_SIZE, offset };

        return svc.listDeliveries(id, batchParams).pipe(
          switchMap((response) => {
            const newAccumulated = [...accumulatedDeliveries, ...response.items];

            if (response.items.length === 0 || newAccumulated.length >= total) {
              return of(
                loadAdminWebhookDeliveriesSuccess({
                  endpointId: id,
                  deliveries: newAccumulated,
                  total,
                }),
              );
            }

            if (response.items.length < ADMIN_WEBHOOKS_BATCH_SIZE) {
              return of(
                loadAdminWebhookDeliveriesSuccess({
                  endpointId: id,
                  deliveries: newAccumulated,
                  total,
                }),
              );
            }

            return of(
              loadAdminWebhookDeliveriesBatch({
                id,
                offset: offset + ADMIN_WEBHOOKS_BATCH_SIZE,
                accumulatedDeliveries: newAccumulated,
                total,
              }),
            );
          }),
          catchError((error) => of(loadAdminWebhookDeliveriesFailure({ error: normalizeError(error) }))),
        );
      }),
    );
  },
  { functional: true },
);
