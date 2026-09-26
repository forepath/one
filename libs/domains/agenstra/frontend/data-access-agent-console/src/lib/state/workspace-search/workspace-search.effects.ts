import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, map, of, switchMap } from 'rxjs';

import { WorkspaceSearchService } from '../../services/workspace-search.service';

import * as WorkspaceSearchActions from './workspace-search.actions';

function normalizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'An unexpected error occurred';
}

export const loadWorkspaceIndexStatus$ = createEffect(
  (actions$ = inject(Actions), service = inject(WorkspaceSearchService)) => {
    return actions$.pipe(
      ofType(WorkspaceSearchActions.loadWorkspaceIndexStatus),
      switchMap(({ clientId, agentId }) =>
        service.getStatus(clientId, agentId).pipe(
          map((status) => WorkspaceSearchActions.loadWorkspaceIndexStatusSuccess({ clientId, agentId, status })),
          catchError((error) =>
            of(
              WorkspaceSearchActions.loadWorkspaceIndexStatusFailure({
                clientId,
                agentId,
                error: normalizeError(error),
              }),
            ),
          ),
        ),
      ),
    );
  },
  { functional: true },
);

export const searchWorkspace$ = createEffect(
  (actions$ = inject(Actions), service = inject(WorkspaceSearchService)) => {
    return actions$.pipe(
      ofType(WorkspaceSearchActions.searchWorkspace),
      switchMap(({ clientId, agentId, query, includePaths, excludePaths, mode }) =>
        service.search(clientId, agentId, query, includePaths, excludePaths, mode).pipe(
          map((response) =>
            WorkspaceSearchActions.searchWorkspaceSuccess({
              clientId,
              agentId,
              status: response.status,
              hits: response.hits,
              total: response.total,
            }),
          ),
          catchError((error) =>
            of(
              WorkspaceSearchActions.searchWorkspaceFailure({
                clientId,
                agentId,
                error: normalizeError(error),
              }),
            ),
          ),
        ),
      ),
    );
  },
  { functional: true },
);

export const reindexWorkspace$ = createEffect(
  (actions$ = inject(Actions), service = inject(WorkspaceSearchService)) => {
    return actions$.pipe(
      ofType(WorkspaceSearchActions.reindexWorkspace),
      switchMap(({ clientId, agentId }) =>
        service.reindex(clientId, agentId).pipe(
          map(() => WorkspaceSearchActions.reindexWorkspaceSuccess({ clientId, agentId })),
          catchError((error) =>
            of(
              WorkspaceSearchActions.reindexWorkspaceFailure({
                clientId,
                agentId,
                error: normalizeError(error),
              }),
            ),
          ),
        ),
      ),
    );
  },
  { functional: true },
);

/** After reindex accepted, refresh status. */
export const reindexWorkspaceRefreshStatus$ = createEffect(
  (actions$ = inject(Actions)) => {
    return actions$.pipe(
      ofType(WorkspaceSearchActions.reindexWorkspaceSuccess),
      map(({ clientId, agentId }) => WorkspaceSearchActions.loadWorkspaceIndexStatus({ clientId, agentId })),
    );
  },
  { functional: true },
);
