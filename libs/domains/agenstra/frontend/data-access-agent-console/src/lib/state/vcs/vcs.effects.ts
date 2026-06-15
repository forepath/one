import { HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, map, mergeMap, of, switchMap, tap } from 'rxjs';

import { VcsService } from '../../services/vcs.service';

import {
  commit,
  commitFailure,
  commitSuccess,
  createBranch,
  createBranchFailure,
  createBranchSuccess,
  deleteBranch,
  deleteBranchFailure,
  deleteBranchSuccess,
  fetch,
  fetchFailure,
  fetchSuccess,
  loadGitBranches,
  loadGitBranchesFailure,
  loadGitBranchesSuccess,
  loadGitDiff,
  loadGitDiffFailure,
  loadGitDiffSuccess,
  loadGitStatus,
  loadGitStatusFailure,
  loadGitStatusSuccess,
  pull,
  pullFailure,
  pullSuccess,
  push,
  pushFailure,
  pushSuccess,
  rebase,
  rebaseFailure,
  rebaseSuccess,
  resolveConflict,
  resolveConflictFailure,
  resolveConflictSuccess,
  stageFiles,
  stageFilesFailure,
  stageFilesSuccess,
  switchBranch,
  switchBranchFailure,
  switchBranchSuccess,
  unstageFiles,
  unstageFilesFailure,
  unstageFilesSuccess,
} from './vcs.actions';

/**
 * Normalizes error messages from HTTP errors.
 */
function normalizeError(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    return error.error?.message || error.message || 'An unexpected error occurred';
  }

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

export const loadGitStatus$ = createEffect(
  (actions$ = inject(Actions), vcsService = inject(VcsService)) => {
    return actions$.pipe(
      ofType(loadGitStatus),
      switchMap(({ clientId, agentId }) =>
        vcsService.getStatus(clientId, agentId).pipe(
          map((status) => loadGitStatusSuccess({ status })),
          catchError((error) => of(loadGitStatusFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const loadGitBranches$ = createEffect(
  (actions$ = inject(Actions), vcsService = inject(VcsService)) => {
    return actions$.pipe(
      ofType(loadGitBranches),
      switchMap(({ clientId, agentId }) =>
        vcsService.getBranches(clientId, agentId).pipe(
          map((branches) => loadGitBranchesSuccess({ branches })),
          catchError((error) => of(loadGitBranchesFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const loadGitDiff$ = createEffect(
  (actions$ = inject(Actions), vcsService = inject(VcsService)) => {
    return actions$.pipe(
      ofType(loadGitDiff),
      switchMap(({ clientId, agentId, filePath }) =>
        vcsService.getFileDiff(clientId, agentId, filePath).pipe(
          map((diff) => loadGitDiffSuccess({ diff })),
          catchError((error) => of(loadGitDiffFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const stageFiles$ = createEffect(
  (actions$ = inject(Actions), vcsService = inject(VcsService)) => {
    return actions$.pipe(
      ofType(stageFiles),
      mergeMap(({ clientId, agentId, dto }) =>
        vcsService.stageFiles(clientId, agentId, dto).pipe(
          map(() => stageFilesSuccess()),
          catchError((error) => of(stageFilesFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const unstageFiles$ = createEffect(
  (actions$ = inject(Actions), vcsService = inject(VcsService)) => {
    return actions$.pipe(
      ofType(unstageFiles),
      mergeMap(({ clientId, agentId, dto }) =>
        vcsService.unstageFiles(clientId, agentId, dto).pipe(
          map(() => unstageFilesSuccess()),
          catchError((error) => of(unstageFilesFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const commit$ = createEffect(
  (actions$ = inject(Actions), vcsService = inject(VcsService)) => {
    return actions$.pipe(
      ofType(commit),
      mergeMap(({ clientId, agentId, dto }) =>
        vcsService.commit(clientId, agentId, dto).pipe(
          map(() => commitSuccess()),
          catchError((error) => of(commitFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const push$ = createEffect(
  (actions$ = inject(Actions), vcsService = inject(VcsService)) => {
    return actions$.pipe(
      ofType(push),
      mergeMap(({ clientId, agentId, force }) =>
        vcsService.push(clientId, agentId, { force }).pipe(
          map(() => pushSuccess()),
          catchError((error) => of(pushFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const pull$ = createEffect(
  (actions$ = inject(Actions), vcsService = inject(VcsService)) => {
    return actions$.pipe(
      ofType(pull),
      mergeMap(({ clientId, agentId }) =>
        vcsService.pull(clientId, agentId).pipe(
          map(() => pullSuccess()),
          catchError((error) => of(pullFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const fetch$ = createEffect(
  (actions$ = inject(Actions), vcsService = inject(VcsService)) => {
    return actions$.pipe(
      ofType(fetch),
      mergeMap(({ clientId, agentId }) =>
        vcsService.fetch(clientId, agentId).pipe(
          map(() => fetchSuccess()),
          catchError((error) => of(fetchFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const rebase$ = createEffect(
  (actions$ = inject(Actions), vcsService = inject(VcsService)) => {
    return actions$.pipe(
      ofType(rebase),
      mergeMap(({ clientId, agentId, dto }) =>
        vcsService.rebase(clientId, agentId, dto).pipe(
          map(() => rebaseSuccess()),
          catchError((error) => of(rebaseFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const switchBranch$ = createEffect(
  (actions$ = inject(Actions), vcsService = inject(VcsService)) => {
    return actions$.pipe(
      ofType(switchBranch),
      mergeMap(({ clientId, agentId, branch }) =>
        vcsService.switchBranch(clientId, agentId, branch).pipe(
          map(() => switchBranchSuccess()),
          catchError((error) => of(switchBranchFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const createBranch$ = createEffect(
  (actions$ = inject(Actions), vcsService = inject(VcsService)) => {
    return actions$.pipe(
      ofType(createBranch),
      mergeMap(({ clientId, agentId, dto }) =>
        vcsService.createBranch(clientId, agentId, dto).pipe(
          map(() => createBranchSuccess()),
          catchError((error) => of(createBranchFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const deleteBranch$ = createEffect(
  (actions$ = inject(Actions), vcsService = inject(VcsService)) => {
    return actions$.pipe(
      ofType(deleteBranch),
      mergeMap(({ clientId, agentId, branch }) =>
        vcsService.deleteBranch(clientId, agentId, branch).pipe(
          map(() => deleteBranchSuccess()),
          catchError((error) => of(deleteBranchFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const resolveConflict$ = createEffect(
  (actions$ = inject(Actions), vcsService = inject(VcsService)) => {
    return actions$.pipe(
      ofType(resolveConflict),
      mergeMap(({ clientId, agentId, dto }) =>
        vcsService.resolveConflict(clientId, agentId, dto).pipe(
          map(() => resolveConflictSuccess()),
          catchError((error) => of(resolveConflictFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

// Note: Effects are exported individually for registration in routes
// Reload status after operations that change git state
export const reloadStatusAfterOperation$ = createEffect(
  (actions$ = inject(Actions)) => {
    return actions$.pipe(
      ofType(
        stageFilesSuccess,
        unstageFilesSuccess,
        commitSuccess,
        pushSuccess,
        pullSuccess,
        fetchSuccess,
        rebaseSuccess,
        switchBranchSuccess,
        createBranchSuccess,
        deleteBranchSuccess,
        resolveConflictSuccess,
      ),
      tap((_) => {
        // Extract clientId and agentId from the action if available
        // For now, we'll need to reload status manually in components
        // This effect can be enhanced later to automatically reload
      }),
    );
  },
  { functional: true, dispatch: false },
);
