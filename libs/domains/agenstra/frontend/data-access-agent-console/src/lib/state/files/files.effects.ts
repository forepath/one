import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, exhaustMap, map, mergeMap, of, switchMap } from 'rxjs';

import { FilesService } from '../../services/files.service';

import {
  createFileOrDirectory,
  createFileOrDirectoryFailure,
  createFileOrDirectorySuccess,
  deleteFileOrDirectory,
  deleteFileOrDirectoryFailure,
  deleteFileOrDirectorySuccess,
  listDirectory,
  listDirectoryFailure,
  listDirectorySuccess,
  moveFileOrDirectory,
  moveFileOrDirectoryFailure,
  moveFileOrDirectorySuccess,
  readFile,
  readFileFailure,
  readFileSuccess,
  writeFile,
  writeFileFailure,
  writeFileSuccess,
} from './files.actions';

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

export const readFile$ = createEffect(
  (actions$ = inject(Actions), filesService = inject(FilesService)) => {
    return actions$.pipe(
      ofType(readFile),
      switchMap(({ clientId, agentId, filePath, context }) => {
        const c = context ?? 'app';

        return filesService.readFile(clientId, agentId, filePath, c).pipe(
          map((content) => readFileSuccess({ clientId, agentId, filePath, content, context: c })),
          catchError((error) =>
            of(readFileFailure({ clientId, agentId, filePath, error: normalizeError(error), context: c })),
          ),
        );
      }),
    );
  },
  { functional: true },
);

export const writeFile$ = createEffect(
  (actions$ = inject(Actions), filesService = inject(FilesService)) => {
    return actions$.pipe(
      ofType(writeFile),
      exhaustMap(({ clientId, agentId, filePath, writeFileDto, context }) => {
        const c = context ?? 'app';

        return filesService.writeFile(clientId, agentId, filePath, writeFileDto, c).pipe(
          map(() => writeFileSuccess({ clientId, agentId, filePath, context: c })),
          catchError((error) =>
            of(writeFileFailure({ clientId, agentId, filePath, error: normalizeError(error), context: c })),
          ),
        );
      }),
    );
  },
  { functional: true },
);

export const listDirectory$ = createEffect(
  (actions$ = inject(Actions), filesService = inject(FilesService)) => {
    return actions$.pipe(
      ofType(listDirectory),
      mergeMap(({ clientId, agentId, params }) => {
        const directoryPath = params?.path || '.';
        const c = params?.context ?? 'app';

        return filesService.listDirectory(clientId, agentId, params).pipe(
          map((files) => listDirectorySuccess({ clientId, agentId, directoryPath, files, context: c })),
          catchError((error) =>
            of(
              listDirectoryFailure({
                clientId,
                agentId,
                directoryPath,
                error: normalizeError(error),
                context: c,
              }),
            ),
          ),
        );
      }),
    );
  },
  { functional: true },
);

export const createFileOrDirectory$ = createEffect(
  (actions$ = inject(Actions), filesService = inject(FilesService)) => {
    return actions$.pipe(
      ofType(createFileOrDirectory),
      exhaustMap(({ clientId, agentId, filePath, createFileDto, context }) => {
        const c = context ?? 'app';

        return filesService.createFileOrDirectory(clientId, agentId, filePath, createFileDto, c).pipe(
          map(() =>
            createFileOrDirectorySuccess({
              clientId,
              agentId,
              filePath,
              fileType: createFileDto.type,
              context: c,
            }),
          ),
          catchError((error) =>
            of(createFileOrDirectoryFailure({ clientId, agentId, filePath, error: normalizeError(error), context: c })),
          ),
        );
      }),
    );
  },
  { functional: true },
);

export const deleteFileOrDirectory$ = createEffect(
  (actions$ = inject(Actions), filesService = inject(FilesService)) => {
    return actions$.pipe(
      ofType(deleteFileOrDirectory),
      exhaustMap(({ clientId, agentId, filePath, context }) => {
        const c = context ?? 'app';

        return filesService.deleteFileOrDirectory(clientId, agentId, filePath, c).pipe(
          map(() => deleteFileOrDirectorySuccess({ clientId, agentId, filePath, context: c })),
          catchError((error) =>
            of(deleteFileOrDirectoryFailure({ clientId, agentId, filePath, error: normalizeError(error), context: c })),
          ),
        );
      }),
    );
  },
  { functional: true },
);

export const moveFileOrDirectory$ = createEffect(
  (actions$ = inject(Actions), filesService = inject(FilesService)) => {
    return actions$.pipe(
      ofType(moveFileOrDirectory),
      exhaustMap(({ clientId, agentId, sourcePath, moveFileDto, context }) => {
        const c = context ?? 'app';

        return filesService.moveFileOrDirectory(clientId, agentId, sourcePath, moveFileDto, c).pipe(
          map(() =>
            moveFileOrDirectorySuccess({
              clientId,
              agentId,
              sourcePath,
              destinationPath: moveFileDto.destination,
              context: c,
            }),
          ),
          catchError((error) =>
            of(moveFileOrDirectoryFailure({ clientId, agentId, sourcePath, error: normalizeError(error), context: c })),
          ),
        );
      }),
    );
  },
  { functional: true },
);
