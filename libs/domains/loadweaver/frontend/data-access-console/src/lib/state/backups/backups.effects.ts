import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { catchError, concatMap, exhaustMap, forkJoin, map, mergeMap, of, switchMap, tap, withLatestFrom } from 'rxjs';

import { BackupsService } from '../../services/backups.service';
import { PlansService } from '../../services/plans.service';
import { apiErrorMessage } from '../../utils/api-error';
import { restoreResourceYaml } from '../../utils/backup-restore';
import {
  backupDeletionAction,
  backupDeletionActionFailure,
  backupDeletionActionSuccess,
  backupNow,
  backupNowFailure,
  backupNowSuccess,
  loadBackup,
  loadBackupDiff,
  loadBackupDiffFailure,
  loadBackupDiffSuccess,
  loadBackupFailure,
  loadBackupFiles,
  loadBackupFilesFailure,
  loadBackupFilesSuccess,
  loadBackups,
  loadBackupsFailure,
  loadBackupsSuccess,
  loadBackupSuccess,
  loadDeletions,
  loadDeletionsFailure,
  loadDeletionsSuccess,
  loadRestores,
  loadRestoresFailure,
  loadRestoresSuccess,
  planRestore,
  planRestoreFailure,
  planRestoreSuccess,
  requestBackupDeletion,
  requestBackupDeletionFailure,
  requestBackupDeletionSuccess,
  startRestoreTest,
  startRestoreTestFailure,
  startRestoreTestSuccess,
} from './backups.actions';
import { selectBackupsProject } from './backups.selectors';

/** Status, catalog and deletion requests; the deletion requests may fail on their own. */
export const loadBackups$ = createEffect(
  (actions$ = inject(Actions), service = inject(BackupsService)) =>
    actions$.pipe(
      ofType(loadBackups),
      switchMap(({ project }) =>
        forkJoin({
          status: service.status(),
          backups: service.catalog({ project, limit: 1000 }),
          deletions: service.deletions().pipe(catchError(() => of(null))),
        }).pipe(
          map((loaded) => loadBackupsSuccess(loaded)),
          catchError((error: unknown) =>
            of(loadBackupsFailure({ error: apiErrorMessage(error, 'Failed to load backups') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

/** A backup and the other backups of its volume (those may fail alone). */
export const loadBackup$ = createEffect(
  (actions$ = inject(Actions), service = inject(BackupsService)) =>
    actions$.pipe(
      ofType(loadBackup),
      switchMap(({ id }) =>
        service.get(id).pipe(
          switchMap((backup) =>
            service.catalog({ resource: backup.resource, project: backup.project, limit: 1000 }).pipe(
              catchError(() => of([backup])),
              map((volumeBackups) => loadBackupSuccess({ backup, volumeBackups })),
            ),
          ),
          catchError((error: unknown) =>
            of(loadBackupFailure({ id, error: apiErrorMessage(error, 'Failed to load the backup') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const loadBackupFiles$ = createEffect(
  (actions$ = inject(Actions), service = inject(BackupsService)) =>
    actions$.pipe(
      ofType(loadBackupFiles),
      switchMap(({ id, path }) =>
        service.files(id, path).pipe(
          map((entries) => loadBackupFilesSuccess({ id, path, entries })),
          catchError((error: unknown) =>
            of(loadBackupFilesFailure({ id, path, error: apiErrorMessage(error, 'Failed to list the backup') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const loadBackupDiff$ = createEffect(
  (actions$ = inject(Actions), service = inject(BackupsService)) =>
    actions$.pipe(
      ofType(loadBackupDiff),
      switchMap(({ from, to }) =>
        forkJoin({ from: service.get(from), to: service.get(to), diff: service.diff(from, to) }).pipe(
          map((loaded) => loadBackupDiffSuccess(loaded)),
          catchError((error: unknown) =>
            of(loadBackupDiffFailure({ from, to, error: apiErrorMessage(error, 'Failed to compare the backups') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const loadRestores$ = createEffect(
  (actions$ = inject(Actions), service = inject(BackupsService)) =>
    actions$.pipe(
      ofType(loadRestores),
      switchMap(({ project }) =>
        forkJoin({
          restores: service.restores(project),
          tests: service.restoreTests({ project }).pipe(catchError(() => of(null))),
        }).pipe(
          map((loaded) => loadRestoresSuccess(loaded)),
          catchError((error: unknown) =>
            of(loadRestoresFailure({ error: apiErrorMessage(error, 'Failed to load restores') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const loadDeletions$ = createEffect(
  (actions$ = inject(Actions), service = inject(BackupsService)) =>
    actions$.pipe(
      ofType(loadDeletions),
      switchMap(() =>
        service.deletions().pipe(
          map((deletions) => loadDeletionsSuccess({ deletions })),
          catchError((error: unknown) =>
            of(loadDeletionsFailure({ error: apiErrorMessage(error, 'Failed to load deletion requests') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const backupNow$ = createEffect(
  (actions$ = inject(Actions), service = inject(BackupsService)) =>
    actions$.pipe(
      ofType(backupNow),
      mergeMap(({ volume }) =>
        service.backupNow(volume).pipe(
          map((backup) => backupNowSuccess({ backup })),
          catchError((error: unknown) =>
            of(backupNowFailure({ volume, error: apiErrorMessage(error, 'Failed to start the backup') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const startRestoreTest$ = createEffect(
  (actions$ = inject(Actions), service = inject(BackupsService)) =>
    actions$.pipe(
      ofType(startRestoreTest),
      mergeMap(({ id }) =>
        service.restoreTest(id).pipe(
          map((test) => startRestoreTestSuccess({ test })),
          catchError((error: unknown) =>
            of(startRestoreTestFailure({ id, error: apiErrorMessage(error, 'Failed to start the restore test') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const requestBackupDeletion$ = createEffect(
  (actions$ = inject(Actions), service = inject(BackupsService)) =>
    actions$.pipe(
      ofType(requestBackupDeletion),
      exhaustMap(({ backupIds, reason }) =>
        service.requestDeletion(backupIds, reason).pipe(
          map((deletion) => requestBackupDeletionSuccess({ deletion })),
          catchError((error: unknown) =>
            of(requestBackupDeletionFailure({ error: apiErrorMessage(error, 'Failed to request the deletion') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

/** Approve (a second admin) or cancel; the API refuses the requester's own approval with a message. */
export const backupDeletionActions$ = createEffect(
  (actions$ = inject(Actions), service = inject(BackupsService)) =>
    actions$.pipe(
      ofType(backupDeletionAction),
      concatMap(({ id, action }) =>
        service.actOnDeletion(id, action).pipe(
          map((deletion) => backupDeletionActionSuccess({ action, deletion })),
          catchError((error: unknown) =>
            of(
              backupDeletionActionFailure({
                id,
                action,
                error: apiErrorMessage(error, `Failed to ${action} the deletion request`),
              }),
            ),
          ),
        ),
      ),
    ),
  { functional: true },
);

/** The catalog changes with "back up now", restore tests and deletion requests. */
export const reloadBackupsAfterChange$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store)) =>
    actions$.pipe(
      ofType(backupNowSuccess, startRestoreTestSuccess, requestBackupDeletionSuccess, backupDeletionActionSuccess),
      withLatestFrom(store.select(selectBackupsProject)),
      map(([, project]) => loadBackups({ project, silent: true })),
    ),
  { functional: true },
);

/** A restore is a `Restore` resource, planned like any change (approvals apply). */
export const planRestore$ = createEffect(
  (actions$ = inject(Actions), plans = inject(PlansService)) =>
    actions$.pipe(
      ofType(planRestore),
      exhaustMap(({ request }) =>
        plans.create({ documents: restoreResourceYaml(request) }).pipe(
          map((plan) => planRestoreSuccess({ plan })),
          catchError((error: unknown) =>
            of(planRestoreFailure({ error: apiErrorMessage(error, 'Failed to plan the restore') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

/** The planned restore is reviewed (and approved / applied) on the plan. */
export const openRestorePlan$ = createEffect(
  (actions$ = inject(Actions), router = inject(Router)) =>
    actions$.pipe(
      ofType(planRestoreSuccess),
      tap(({ plan }) => void router.navigate(['/activity/plans', plan.id])),
    ),
  { functional: true, dispatch: false },
);
