import { HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { catchError, concatMap, map, mergeMap, of, switchMap, withLatestFrom } from 'rxjs';

import { DeploymentConnectionsService } from '../../services/deployment-connections.service';

import {
  createDeploymentConnection,
  createDeploymentConnectionSuccess,
  deleteDeploymentConnection,
  deleteDeploymentConnectionSuccess,
  loadDeploymentConnections,
  loadDeploymentConnectionsFailure,
  loadDeploymentConnectionsSuccess,
  saveDeploymentConnectionFailure,
  testDeploymentConnection,
  testDeploymentConnectionFailure,
  testDeploymentConnectionSuccess,
  updateDeploymentConnection,
  updateDeploymentConnectionSuccess,
} from './deployment-connections.actions';
import { selectDeploymentConnectionsQuery } from './deployment-connections.selectors';
import { DEPLOYMENT_CONNECTIONS_DEFAULT_LIMIT } from './deployment-connections.types';

function normalizeError(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    const message = error.error?.message;

    if (Array.isArray(message)) {
      return message.join('; ');
    }

    return message ?? error.message ?? String(error.status);
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'An unexpected error occurred';
}

export const loadDeploymentConnections$ = createEffect(
  (actions$ = inject(Actions), service = inject(DeploymentConnectionsService)) =>
    actions$.pipe(
      ofType(loadDeploymentConnections),
      switchMap(({ query }) => {
        const limit = query.limit ?? DEPLOYMENT_CONNECTIONS_DEFAULT_LIMIT;

        return service.list({ ...query, limit }).pipe(
          map((connections) => loadDeploymentConnectionsSuccess({ connections, hasNext: connections.length >= limit })),
          catchError((error) => of(loadDeploymentConnectionsFailure({ error: normalizeError(error) }))),
        );
      }),
    ),
  { functional: true },
);

export const createDeploymentConnection$ = createEffect(
  (actions$ = inject(Actions), service = inject(DeploymentConnectionsService)) =>
    actions$.pipe(
      ofType(createDeploymentConnection),
      concatMap(({ dto }) =>
        service.create(dto).pipe(
          map((connection) => createDeploymentConnectionSuccess({ connection })),
          catchError((error) => of(saveDeploymentConnectionFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const updateDeploymentConnection$ = createEffect(
  (actions$ = inject(Actions), service = inject(DeploymentConnectionsService)) =>
    actions$.pipe(
      ofType(updateDeploymentConnection),
      concatMap(({ id, dto }) =>
        service.update(id, dto).pipe(
          map((connection) => updateDeploymentConnectionSuccess({ connection })),
          catchError((error) => of(saveDeploymentConnectionFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const deleteDeploymentConnection$ = createEffect(
  (actions$ = inject(Actions), service = inject(DeploymentConnectionsService)) =>
    actions$.pipe(
      ofType(deleteDeploymentConnection),
      concatMap(({ id }) =>
        service.delete(id).pipe(
          map(() => deleteDeploymentConnectionSuccess({ id })),
          catchError((error) => of(saveDeploymentConnectionFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

/** A created / deleted connection shifts the server pages: reload the listed page. */
export const reloadDeploymentConnectionsAfterWrite$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store)) =>
    actions$.pipe(
      ofType(createDeploymentConnectionSuccess, deleteDeploymentConnectionSuccess),
      withLatestFrom(store.select(selectDeploymentConnectionsQuery)),
      map(([, query]) => loadDeploymentConnections({ query })),
    ),
  { functional: true },
);

export const testDeploymentConnection$ = createEffect(
  (actions$ = inject(Actions), service = inject(DeploymentConnectionsService)) =>
    actions$.pipe(
      ofType(testDeploymentConnection),
      mergeMap(({ id }) =>
        service.test(id).pipe(
          map((result) => testDeploymentConnectionSuccess({ id, result })),
          catchError((error) => of(testDeploymentConnectionFailure({ id, error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);
