import { HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, exhaustMap, filter, map, mergeMap, type Observable, of, switchMap } from 'rxjs';

import { GitService } from '../../services/git.service';
import type { GitConnectionActionKind, GitConnectionActionResult } from '../../types/git.types';
import { apiErrorMessage } from '../../utils/api-error';
import {
  createGitConnection,
  createGitConnectionFailure,
  createGitConnectionSuccess,
  deleteGitConnection,
  deleteGitConnectionFailure,
  deleteGitConnectionSuccess,
  loadGitCommits,
  loadGitCommitsFailure,
  loadGitCommitsSuccess,
  loadGitConnections,
  loadGitConnectionsFailure,
  loadGitConnectionsSuccess,
  loadGitSopsRecipient,
  loadGitSopsRecipientFailure,
  loadGitSopsRecipientSuccess,
  revealGitWebhookSecret,
  revealGitWebhookSecretFailure,
  revealGitWebhookSecretSuccess,
  rotateGitWebhookSecret,
  rotateGitWebhookSecretFailure,
  rotateGitWebhookSecretSuccess,
  runGitConnectionAction,
  runGitConnectionActionFailure,
  runGitConnectionActionSuccess,
  updateGitConnection,
  updateGitConnectionFailure,
  updateGitConnectionSuccess,
} from './git.actions';

const ACTION_FAILURE: Record<GitConnectionActionKind, string> = {
  test: 'Failed to test the connection',
  sync: 'Failed to sync the branch',
  export: 'Failed to export to the repository',
  'reset-host-key': 'Failed to reset the SSH host key',
};

function runAction(
  service: GitService,
  id: string,
  action: GitConnectionActionKind,
  force: boolean,
): Observable<GitConnectionActionResult> {
  switch (action) {
    case 'test':
      return service.test(id).pipe(map((result) => ({ action, result })));
    case 'sync':
      return service.sync(id).pipe(map((result) => ({ action, result })));
    case 'export':
      return service.exportToRepo(id, force).pipe(map((result) => ({ action, result })));
    default:
      return service.resetHostKey(id).pipe(map((result) => ({ action: 'reset-host-key' as const, result })));
  }
}

export const loadGitConnections$ = createEffect(
  (actions$ = inject(Actions), service = inject(GitService)) =>
    actions$.pipe(
      ofType(loadGitConnections),
      switchMap(() =>
        service.list().pipe(
          map((connections) => loadGitConnectionsSuccess({ connections })),
          catchError((error: unknown) =>
            of(loadGitConnectionsFailure({ error: apiErrorMessage(error, 'Failed to load the Git connections') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const loadGitCommits$ = createEffect(
  (actions$ = inject(Actions), service = inject(GitService)) =>
    actions$.pipe(
      ofType(loadGitCommits),
      switchMap(({ id }) =>
        service.commits(id).pipe(
          map((commits) => loadGitCommitsSuccess({ id, commits })),
          catchError((error: unknown) =>
            of(loadGitCommitsFailure({ id, error: apiErrorMessage(error, 'Failed to load the commits') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const createGitConnection$ = createEffect(
  (actions$ = inject(Actions), service = inject(GitService)) =>
    actions$.pipe(
      ofType(createGitConnection),
      exhaustMap(({ request }) =>
        service.create(request).pipe(
          map((connection) => createGitConnectionSuccess({ connection })),
          catchError((error: unknown) =>
            of(createGitConnectionFailure({ error: apiErrorMessage(error, 'Failed to connect the repository') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const updateGitConnection$ = createEffect(
  (actions$ = inject(Actions), service = inject(GitService)) =>
    actions$.pipe(
      ofType(updateGitConnection),
      exhaustMap(({ id, request }) =>
        service.update(id, request).pipe(
          map((connection) => updateGitConnectionSuccess({ connection })),
          catchError((error: unknown) =>
            of(updateGitConnectionFailure({ error: apiErrorMessage(error, 'Failed to save the connection') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const deleteGitConnection$ = createEffect(
  (actions$ = inject(Actions), service = inject(GitService)) =>
    actions$.pipe(
      ofType(deleteGitConnection),
      mergeMap(({ id }) =>
        service.remove(id).pipe(
          map(() => deleteGitConnectionSuccess({ id })),
          catchError((error: unknown) =>
            of(deleteGitConnectionFailure({ id, error: apiErrorMessage(error, 'Failed to disconnect') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const runGitConnectionAction$ = createEffect(
  (actions$ = inject(Actions), service = inject(GitService)) =>
    actions$.pipe(
      ofType(runGitConnectionAction),
      exhaustMap(({ id, action, force }) =>
        runAction(service, id, action, force === true).pipe(
          map((outcome) => runGitConnectionActionSuccess({ id, outcome })),
          catchError((error: unknown) =>
            of(runGitConnectionActionFailure({ id, action, error: apiErrorMessage(error, ACTION_FAILURE[action]) })),
          ),
        ),
      ),
    ),
  { functional: true },
);

/** After a sync or export the connection (last commit, error) and its commits changed. */
export const reloadAfterGitAction$ = createEffect(
  (actions$ = inject(Actions)) =>
    actions$.pipe(
      ofType(runGitConnectionActionSuccess, runGitConnectionActionFailure),
      filter((action) => {
        const kind = 'outcome' in action ? action.outcome.action : action.action;

        return kind === 'sync' || kind === 'export' || kind === 'test';
      }),
      mergeMap((action) => [loadGitConnections({ silent: true }), loadGitCommits({ id: action.id, silent: true })]),
    ),
  { functional: true },
);

export const revealGitWebhookSecret$ = createEffect(
  (actions$ = inject(Actions), service = inject(GitService)) =>
    actions$.pipe(
      ofType(revealGitWebhookSecret),
      exhaustMap(({ id }) =>
        service.webhookSecret(id).pipe(
          map(({ webhookSecret }) => revealGitWebhookSecretSuccess({ id, secret: webhookSecret })),
          catchError((error: unknown) =>
            of(
              revealGitWebhookSecretFailure({ id, error: apiErrorMessage(error, 'Failed to read the webhook secret') }),
            ),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const rotateGitWebhookSecret$ = createEffect(
  (actions$ = inject(Actions), service = inject(GitService)) =>
    actions$.pipe(
      ofType(rotateGitWebhookSecret),
      exhaustMap(({ id }) =>
        service.rotateWebhookSecret(id).pipe(
          map(({ webhookSecret, webhookGeneration }) =>
            rotateGitWebhookSecretSuccess({ id, secret: webhookSecret, generation: webhookGeneration }),
          ),
          catchError((error: unknown) =>
            of(
              rotateGitWebhookSecretFailure({
                id,
                error: apiErrorMessage(error, 'Failed to rotate the webhook secret'),
              }),
            ),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const loadGitSopsRecipient$ = createEffect(
  (actions$ = inject(Actions), service = inject(GitService)) =>
    actions$.pipe(
      ofType(loadGitSopsRecipient),
      switchMap(() =>
        service.sopsRecipient().pipe(
          map(({ recipient }) => loadGitSopsRecipientSuccess({ recipient: recipient ?? null })),
          catchError((error: unknown) =>
            of(
              loadGitSopsRecipientFailure({
                error: apiErrorMessage(error, 'Failed to read the SOPS recipient'),
                unavailable: error instanceof HttpErrorResponse && error.status === 404,
              }),
            ),
          ),
        ),
      ),
    ),
  { functional: true },
);
