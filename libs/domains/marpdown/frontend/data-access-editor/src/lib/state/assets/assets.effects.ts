import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, exhaustMap, map, mergeMap, of } from 'rxjs';

import { PresentationAssetsService } from '../../services/presentation-assets.service';

import {
  createAsset,
  createAssetFailure,
  createAssetSuccess,
  deleteAsset,
  deleteAssetFailure,
  deleteAssetSuccess,
  listAssetDirectory,
  listAssetDirectoryFailure,
  listAssetDirectorySuccess,
  moveAsset,
  moveAssetFailure,
  moveAssetSuccess,
  readAsset,
  readAssetFailure,
  readAssetSuccess,
  writeAsset,
  writeAssetFailure,
  writeAssetSuccess,
} from './assets.actions';

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

export const listAssetDirectory$ = createEffect(
  (actions$ = inject(Actions), assetsService = inject(PresentationAssetsService)) => {
    return actions$.pipe(
      ofType(listAssetDirectory),
      mergeMap(({ presentationId, directoryPath = '.' }) =>
        assetsService.listDirectory(presentationId, directoryPath).pipe(
          map((files) => listAssetDirectorySuccess({ presentationId, directoryPath, files })),
          catchError((error) =>
            of(listAssetDirectoryFailure({ presentationId, directoryPath, error: normalizeError(error) })),
          ),
        ),
      ),
    );
  },
  { functional: true },
);

export const readAsset$ = createEffect(
  (actions$ = inject(Actions), assetsService = inject(PresentationAssetsService)) => {
    return actions$.pipe(
      ofType(readAsset),
      mergeMap(({ presentationId, assetPath }) =>
        assetsService.readAsset(presentationId, assetPath).pipe(
          map((content) => readAssetSuccess({ presentationId, assetPath, content })),
          catchError((error) => of(readAssetFailure({ presentationId, assetPath, error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const writeAsset$ = createEffect(
  (actions$ = inject(Actions), assetsService = inject(PresentationAssetsService)) => {
    return actions$.pipe(
      ofType(writeAsset),
      exhaustMap(({ presentationId, assetPath, dto }) =>
        assetsService.writeAsset(presentationId, assetPath, dto).pipe(
          map(() => writeAssetSuccess({ presentationId, assetPath })),
          catchError((error) => of(writeAssetFailure({ presentationId, assetPath, error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const createAsset$ = createEffect(
  (actions$ = inject(Actions), assetsService = inject(PresentationAssetsService)) => {
    return actions$.pipe(
      ofType(createAsset),
      exhaustMap(({ presentationId, assetPath, dto }) =>
        assetsService.createAsset(presentationId, assetPath, dto).pipe(
          map(() => createAssetSuccess({ presentationId, assetPath })),
          catchError((error) => of(createAssetFailure({ presentationId, assetPath, error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const deleteAsset$ = createEffect(
  (actions$ = inject(Actions), assetsService = inject(PresentationAssetsService)) => {
    return actions$.pipe(
      ofType(deleteAsset),
      exhaustMap(({ presentationId, assetPath }) =>
        assetsService.deleteAsset(presentationId, assetPath).pipe(
          map(() => deleteAssetSuccess({ presentationId, assetPath })),
          catchError((error) => of(deleteAssetFailure({ presentationId, assetPath, error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const moveAsset$ = createEffect(
  (actions$ = inject(Actions), assetsService = inject(PresentationAssetsService)) => {
    return actions$.pipe(
      ofType(moveAsset),
      exhaustMap(({ presentationId, assetPath, dto }) =>
        assetsService.moveAsset(presentationId, assetPath, dto).pipe(
          map(() =>
            moveAssetSuccess({
              presentationId,
              sourcePath: assetPath,
              destinationPath: dto.destinationPath,
            }),
          ),
          catchError((error) => of(moveAssetFailure({ presentationId, assetPath, error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);
