import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { catchError, concatMap, filter, map, of, switchMap, withLatestFrom, type Observable } from 'rxjs';

import { LiveFilesService } from '../../services/live-files.service';
import type { LiveFileOperation, LiveFileTarget } from '../../types/live.types';
import { apiErrorMessage } from '../../utils/api-error';
import {
  fileOperationFailure,
  fileOperationSuccess,
  openFilesDirectory,
  openFilesDirectoryFailure,
  openFilesDirectorySuccess,
  refreshFiles,
  runFileOperation,
} from './files.actions';
import { selectConsoleFilesState } from './files.selectors';

export const openFilesDirectory$ = createEffect(
  (actions$ = inject(Actions), service = inject(LiveFilesService)) =>
    actions$.pipe(
      ofType(openFilesDirectory),
      switchMap(({ target, path }) =>
        service.list(target, path).pipe(
          map((entries) => openFilesDirectorySuccess({ target, path, entries })),
          catchError((error: unknown) =>
            of(
              openFilesDirectoryFailure({
                target,
                path,
                error: apiErrorMessage(error, 'Failed to list the directory'),
              }),
            ),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const refreshFiles$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store)) =>
    actions$.pipe(
      ofType(refreshFiles),
      withLatestFrom(store.select(selectConsoleFilesState)),
      filter(([, state]) => state.target !== null),
      map(([, state]) => openFilesDirectory({ target: state.target as LiveFileTarget, path: state.path })),
    ),
  { functional: true },
);

function run(service: LiveFilesService, target: LiveFileTarget, op: LiveFileOperation): Observable<string | null> {
  switch (op.kind) {
    case 'create':
      return service.create(target, op.path, op.type);
    case 'delete':
      return service.remove(target, op.path);
    case 'move':
      return service.move(target, op.path, op.destination, op.overwrite);
    case 'copy':
      return service.copy(target, op.path, op.destination, op.overwrite);
  }
}

/** One after the other (a move right after a create must see the file). */
export const runFileOperation$ = createEffect(
  (actions$ = inject(Actions), service = inject(LiveFilesService)) =>
    actions$.pipe(
      ofType(runFileOperation),
      concatMap(({ target, operation }) =>
        run(service, target, operation).pipe(
          map((warning) => fileOperationSuccess({ operation, warning })),
          catchError((error: unknown) =>
            of(
              fileOperationFailure({ error: apiErrorMessage(error, `Failed to ${operation.kind} ${operation.path}`) }),
            ),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const reloadAfterFileOperation$ = createEffect(
  (actions$ = inject(Actions)) =>
    actions$.pipe(
      ofType(fileOperationSuccess),
      map(() => refreshFiles()),
    ),
  { functional: true },
);
