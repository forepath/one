import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, exhaustMap, map, of, switchMap } from 'rxjs';

import { EnvService } from '../../services/env.service';

import {
  createEnvironmentVariable,
  createEnvironmentVariableFailure,
  createEnvironmentVariableSuccess,
  deleteAllEnvironmentVariables,
  deleteAllEnvironmentVariablesFailure,
  deleteAllEnvironmentVariablesSuccess,
  deleteEnvironmentVariable,
  deleteEnvironmentVariableFailure,
  deleteEnvironmentVariableSuccess,
  loadEnvironmentVariables,
  loadEnvironmentVariablesBatch,
  loadEnvironmentVariablesCount,
  loadEnvironmentVariablesCountFailure,
  loadEnvironmentVariablesCountSuccess,
  loadEnvironmentVariablesFailure,
  loadEnvironmentVariablesSuccess,
  updateEnvironmentVariable,
  updateEnvironmentVariableFailure,
  updateEnvironmentVariableSuccess,
} from './env.actions';

/**
 * Normalizes error messages from HTTP errors.
 */
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

const BATCH_SIZE = 50;

export const loadEnvironmentVariables$ = createEffect(
  (actions$ = inject(Actions), envService = inject(EnvService)) => {
    return actions$.pipe(
      ofType(loadEnvironmentVariables),
      switchMap(({ clientId, agentId }) => {
        // Start with offset 0, limit 50, ignore user params for batch loading
        const batchParams = { limit: BATCH_SIZE, offset: 0 };

        return envService.listEnvironmentVariables(clientId, agentId, batchParams).pipe(
          switchMap((environmentVariables) => {
            if (environmentVariables.length === 0) {
              // No entries, dispatch success with empty array
              return of(loadEnvironmentVariablesSuccess({ clientId, agentId, environmentVariables: [] }));
            }

            // Has entries, check if we got a full batch (might be more)
            if (environmentVariables.length < BATCH_SIZE) {
              // Partial batch, we're done
              return of(loadEnvironmentVariablesSuccess({ clientId, agentId, environmentVariables }));
            }

            // Full batch, load next batch
            return of(
              loadEnvironmentVariablesBatch({
                clientId,
                agentId,
                offset: BATCH_SIZE,
                accumulatedEnvVars: environmentVariables,
              }),
            );
          }),
          catchError((error) =>
            of(loadEnvironmentVariablesFailure({ clientId, agentId, error: normalizeError(error) })),
          ),
        );
      }),
    );
  },
  { functional: true },
);

export const loadEnvironmentVariablesBatch$ = createEffect(
  (actions$ = inject(Actions), envService = inject(EnvService)) => {
    return actions$.pipe(
      ofType(loadEnvironmentVariablesBatch),
      switchMap(({ clientId, agentId, offset, accumulatedEnvVars }) => {
        const batchParams = { limit: BATCH_SIZE, offset };

        return envService.listEnvironmentVariables(clientId, agentId, batchParams).pipe(
          switchMap((environmentVariables) => {
            const newAccumulated = [...accumulatedEnvVars, ...environmentVariables];

            if (environmentVariables.length === 0) {
              // No more entries, dispatch success with all accumulated
              return of(loadEnvironmentVariablesSuccess({ clientId, agentId, environmentVariables: newAccumulated }));
            }

            // Has entries, check if we got a full batch (might be more)
            if (environmentVariables.length < BATCH_SIZE) {
              // Partial batch, we're done
              return of(loadEnvironmentVariablesSuccess({ clientId, agentId, environmentVariables: newAccumulated }));
            }

            // Full batch, load next batch
            return of(
              loadEnvironmentVariablesBatch({
                clientId,
                agentId,
                offset: offset + BATCH_SIZE,
                accumulatedEnvVars: newAccumulated,
              }),
            );
          }),
          catchError((error) =>
            of(loadEnvironmentVariablesFailure({ clientId, agentId, error: normalizeError(error) })),
          ),
        );
      }),
    );
  },
  { functional: true },
);

export const loadEnvironmentVariablesCount$ = createEffect(
  (actions$ = inject(Actions), envService = inject(EnvService)) => {
    return actions$.pipe(
      ofType(loadEnvironmentVariablesCount),
      switchMap(({ clientId, agentId }) =>
        envService.countEnvironmentVariables(clientId, agentId).pipe(
          map((response) => loadEnvironmentVariablesCountSuccess({ clientId, agentId, count: response.count })),
          catchError((error) =>
            of(loadEnvironmentVariablesCountFailure({ clientId, agentId, error: normalizeError(error) })),
          ),
        ),
      ),
    );
  },
  { functional: true },
);

export const createEnvironmentVariable$ = createEffect(
  (actions$ = inject(Actions), envService = inject(EnvService)) => {
    return actions$.pipe(
      ofType(createEnvironmentVariable),
      exhaustMap(({ clientId, agentId, createDto }) =>
        envService.createEnvironmentVariable(clientId, agentId, createDto).pipe(
          map((environmentVariable) => createEnvironmentVariableSuccess({ clientId, agentId, environmentVariable })),
          catchError((error) =>
            of(createEnvironmentVariableFailure({ clientId, agentId, error: normalizeError(error) })),
          ),
        ),
      ),
    );
  },
  { functional: true },
);

export const updateEnvironmentVariable$ = createEffect(
  (actions$ = inject(Actions), envService = inject(EnvService)) => {
    return actions$.pipe(
      ofType(updateEnvironmentVariable),
      exhaustMap(({ clientId, agentId, envVarId, updateDto }) =>
        envService.updateEnvironmentVariable(clientId, agentId, envVarId, updateDto).pipe(
          map((environmentVariable) => updateEnvironmentVariableSuccess({ clientId, agentId, environmentVariable })),
          catchError((error) =>
            of(updateEnvironmentVariableFailure({ clientId, agentId, envVarId, error: normalizeError(error) })),
          ),
        ),
      ),
    );
  },
  { functional: true },
);

export const deleteEnvironmentVariable$ = createEffect(
  (actions$ = inject(Actions), envService = inject(EnvService)) => {
    return actions$.pipe(
      ofType(deleteEnvironmentVariable),
      exhaustMap(({ clientId, agentId, envVarId }) =>
        envService.deleteEnvironmentVariable(clientId, agentId, envVarId).pipe(
          map(() => deleteEnvironmentVariableSuccess({ clientId, agentId, envVarId })),
          catchError((error) =>
            of(deleteEnvironmentVariableFailure({ clientId, agentId, envVarId, error: normalizeError(error) })),
          ),
        ),
      ),
    );
  },
  { functional: true },
);

export const deleteAllEnvironmentVariables$ = createEffect(
  (actions$ = inject(Actions), envService = inject(EnvService)) => {
    return actions$.pipe(
      ofType(deleteAllEnvironmentVariables),
      exhaustMap(({ clientId, agentId }) =>
        envService.deleteAllEnvironmentVariables(clientId, agentId).pipe(
          map((response) =>
            deleteAllEnvironmentVariablesSuccess({ clientId, agentId, deletedCount: response.deletedCount }),
          ),
          catchError((error) =>
            of(deleteAllEnvironmentVariablesFailure({ clientId, agentId, error: normalizeError(error) })),
          ),
        ),
      ),
    );
  },
  { functional: true },
);
