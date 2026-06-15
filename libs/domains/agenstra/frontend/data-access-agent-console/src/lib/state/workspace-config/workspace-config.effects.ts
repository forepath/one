import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, exhaustMap, map, of, switchMap } from 'rxjs';

import { WorkspaceConfigService } from '../../services/workspace-config.service';

import {
  deleteWorkspaceConfigurationOverride,
  deleteWorkspaceConfigurationOverrideFailure,
  deleteWorkspaceConfigurationOverrideSuccess,
  loadWorkspaceConfigurationOverrides,
  loadWorkspaceConfigurationOverridesFailure,
  loadWorkspaceConfigurationOverridesSuccess,
  upsertWorkspaceConfigurationOverride,
  upsertWorkspaceConfigurationOverrideFailure,
  upsertWorkspaceConfigurationOverrideSuccess,
} from './workspace-config.actions';

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

export const loadWorkspaceConfigurationOverrides$ = createEffect(
  (actions$ = inject(Actions), service = inject(WorkspaceConfigService)) => {
    return actions$.pipe(
      ofType(loadWorkspaceConfigurationOverrides),
      switchMap(({ clientId }) =>
        service.listConfigurationOverrides(clientId).pipe(
          map((settings) => loadWorkspaceConfigurationOverridesSuccess({ clientId, settings })),
          catchError((error) =>
            of(loadWorkspaceConfigurationOverridesFailure({ clientId, error: normalizeError(error) })),
          ),
        ),
      ),
    );
  },
  { functional: true },
);

export const upsertWorkspaceConfigurationOverride$ = createEffect(
  (actions$ = inject(Actions), service = inject(WorkspaceConfigService)) => {
    return actions$.pipe(
      ofType(upsertWorkspaceConfigurationOverride),
      exhaustMap(({ clientId, settingKey, dto }) =>
        service.upsertConfigurationOverride(clientId, settingKey, dto).pipe(
          map((setting) => upsertWorkspaceConfigurationOverrideSuccess({ clientId, setting })),
          catchError((error) =>
            of(upsertWorkspaceConfigurationOverrideFailure({ clientId, settingKey, error: normalizeError(error) })),
          ),
        ),
      ),
    );
  },
  { functional: true },
);

export const deleteWorkspaceConfigurationOverride$ = createEffect(
  (actions$ = inject(Actions), service = inject(WorkspaceConfigService)) => {
    return actions$.pipe(
      ofType(deleteWorkspaceConfigurationOverride),
      exhaustMap(({ clientId, settingKey }) =>
        service.deleteConfigurationOverride(clientId, settingKey).pipe(
          map(() => deleteWorkspaceConfigurationOverrideSuccess({ clientId, settingKey })),
          catchError((error) =>
            of(deleteWorkspaceConfigurationOverrideFailure({ clientId, settingKey, error: normalizeError(error) })),
          ),
        ),
      ),
    );
  },
  { functional: true },
);

export const reloadWorkspaceConfigurationAfterMutation$ = createEffect(
  (actions$ = inject(Actions)) => {
    return actions$.pipe(
      ofType(upsertWorkspaceConfigurationOverrideSuccess, deleteWorkspaceConfigurationOverrideSuccess),
      map(({ clientId }) => loadWorkspaceConfigurationOverrides({ clientId, silent: true })),
    );
  },
  { functional: true },
);
