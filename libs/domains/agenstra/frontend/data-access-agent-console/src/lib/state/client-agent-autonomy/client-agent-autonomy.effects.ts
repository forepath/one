import { HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, map, of, switchMap } from 'rxjs';

import { ClientsService } from '../../services/clients.service';

import {
  loadClientAgentAutonomy,
  loadClientAgentAutonomyFailure,
  loadClientAgentAutonomySuccess,
  upsertClientAgentAutonomy,
  upsertClientAgentAutonomyFailure,
  upsertClientAgentAutonomySuccess,
} from './client-agent-autonomy.actions';
import type { ClientAgentAutonomyResponseDto } from './client-agent-autonomy.types';

/** Missing autonomy row (404) is normal — use defaults so the UI can edit and save without a spurious error. */
function defaultAutonomyWhenMissing(clientId: string, agentId: string): ClientAgentAutonomyResponseDto {
  const now = new Date().toISOString();

  return {
    clientId,
    agentId,
    enabled: false,
    preImproveTicket: false,
    maxRuntimeMs: 3_600_000,
    maxIterations: 25,
    tokenBudgetLimit: null,
    createdAt: now,
    updatedAt: now,
  };
}

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

export const loadClientAgentAutonomy$ = createEffect(
  (actions$ = inject(Actions), clientsService = inject(ClientsService)) => {
    return actions$.pipe(
      ofType(loadClientAgentAutonomy),
      switchMap(({ clientId, agentId }) =>
        clientsService.getClientAgentAutonomy(clientId, agentId).pipe(
          map((autonomy) => loadClientAgentAutonomySuccess({ autonomy })),
          catchError((error) => {
            if (error instanceof HttpErrorResponse && error.status === 404) {
              return of(loadClientAgentAutonomySuccess({ autonomy: defaultAutonomyWhenMissing(clientId, agentId) }));
            }

            return of(loadClientAgentAutonomyFailure({ error: normalizeError(error) }));
          }),
        ),
      ),
    );
  },
  { functional: true },
);

export const upsertClientAgentAutonomy$ = createEffect(
  (actions$ = inject(Actions), clientsService = inject(ClientsService)) => {
    return actions$.pipe(
      ofType(upsertClientAgentAutonomy),
      switchMap(({ clientId, agentId, dto }) =>
        clientsService.upsertClientAgentAutonomy(clientId, agentId, dto).pipe(
          map((autonomy) => upsertClientAgentAutonomySuccess({ autonomy })),
          catchError((error) => of(upsertClientAgentAutonomyFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);
