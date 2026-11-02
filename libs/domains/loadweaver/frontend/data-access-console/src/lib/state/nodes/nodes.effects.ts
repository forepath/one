import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, concatMap, exhaustMap, forkJoin, map, mergeMap, of, switchMap } from 'rxjs';

import { NodesService } from '../../services/nodes.service';
import { apiErrorMessage } from '../../utils/api-error';
import {
  createJoinToken,
  createJoinTokenFailure,
  createJoinTokenSuccess,
  loadJoinTokens,
  loadJoinTokensFailure,
  loadJoinTokensSuccess,
  loadNode,
  loadNodeFailure,
  loadNodes,
  loadNodesFailure,
  loadNodesSuccess,
  loadNodeSuccess,
  nodeAction,
  nodeActionFailure,
  nodeActionSuccess,
  revokeJoinToken,
  revokeJoinTokenFailure,
  revokeJoinTokenSuccess,
} from './nodes.actions';

/** Nodes with the cluster summary (sites, control-plane membership); the summary is optional. */
export const loadNodes$ = createEffect(
  (actions$ = inject(Actions), service = inject(NodesService)) =>
    actions$.pipe(
      ofType(loadNodes),
      switchMap(() =>
        forkJoin({ nodes: service.list(), cluster: service.cluster().pipe(catchError(() => of(null))) }).pipe(
          map(({ nodes, cluster }) => loadNodesSuccess({ nodes, cluster })),
          catchError((error: unknown) =>
            of(loadNodesFailure({ error: apiErrorMessage(error, 'Failed to load nodes') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const loadNode$ = createEffect(
  (actions$ = inject(Actions), service = inject(NodesService)) =>
    actions$.pipe(
      ofType(loadNode),
      switchMap(({ name }) =>
        service.get(name).pipe(
          map((node) => loadNodeSuccess({ node })),
          catchError((error: unknown) =>
            of(loadNodeFailure({ name, error: apiErrorMessage(error, 'Failed to load the node') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const nodeActions$ = createEffect(
  (actions$ = inject(Actions), service = inject(NodesService)) =>
    actions$.pipe(
      ofType(nodeAction),
      concatMap(({ name, action }) =>
        service.act(name, action).pipe(
          map((node) => nodeActionSuccess({ action, node })),
          catchError((error: unknown) =>
            of(nodeActionFailure({ name, action, error: apiErrorMessage(error, `Failed to ${action} the node`) })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const loadJoinTokens$ = createEffect(
  (actions$ = inject(Actions), service = inject(NodesService)) =>
    actions$.pipe(
      ofType(loadJoinTokens),
      switchMap(() =>
        service.joinTokens().pipe(
          map((tokens) => loadJoinTokensSuccess({ tokens })),
          catchError((error: unknown) =>
            of(loadJoinTokensFailure({ error: apiErrorMessage(error, 'Failed to load join tokens') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const createJoinToken$ = createEffect(
  (actions$ = inject(Actions), service = inject(NodesService)) =>
    actions$.pipe(
      ofType(createJoinToken),
      exhaustMap(({ request }) =>
        service.createJoinToken(request).pipe(
          map((token) => createJoinTokenSuccess({ token })),
          catchError((error: unknown) =>
            of(createJoinTokenFailure({ error: apiErrorMessage(error, 'Failed to create the join token') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const revokeJoinToken$ = createEffect(
  (actions$ = inject(Actions), service = inject(NodesService)) =>
    actions$.pipe(
      ofType(revokeJoinToken),
      mergeMap(({ id }) =>
        service.revokeJoinToken(id).pipe(
          map(() => revokeJoinTokenSuccess({ id })),
          catchError((error: unknown) =>
            of(revokeJoinTokenFailure({ id, error: apiErrorMessage(error, 'Failed to revoke the join token') })),
          ),
        ),
      ),
    ),
  { functional: true },
);
