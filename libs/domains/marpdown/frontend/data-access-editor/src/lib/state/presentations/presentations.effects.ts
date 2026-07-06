import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, exhaustMap, map, of, switchMap } from 'rxjs';

import { PRESENTATIONS_BATCH_SIZE } from '@forepath/marpdown/marpdown/shared';

import { PresentationsService } from '../../services/presentations.service';

import {
  createPresentation,
  createPresentationFailure,
  createPresentationSuccess,
  deletePresentation,
  deletePresentationFailure,
  deletePresentationSuccess,
  importPresentationMarkdown,
  importPresentationMarkdownFailure,
  importPresentationMarkdownSuccess,
  loadPresentation,
  loadPresentationFailure,
  loadPresentations,
  loadPresentationsBatch,
  loadPresentationsFailure,
  loadPresentationsSuccess,
  loadPresentationSuccess,
  updatePresentation,
  updatePresentationFailure,
  updatePresentationSuccess,
} from './presentations.actions';

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

const BATCH_SIZE = PRESENTATIONS_BATCH_SIZE;

export const loadPresentations$ = createEffect(
  (actions$ = inject(Actions), presentationsService = inject(PresentationsService)) => {
    return actions$.pipe(
      ofType(loadPresentations),
      switchMap(() => {
        const batchParams = { limit: BATCH_SIZE, offset: 0 };

        return presentationsService.listPresentations(batchParams).pipe(
          switchMap((response) => {
            const presentations = response.items;

            if (presentations.length === 0) {
              return of(loadPresentationsSuccess({ presentations: [], total: response.total }));
            }

            if (presentations.length < BATCH_SIZE || presentations.length >= response.total) {
              return of(loadPresentationsSuccess({ presentations, total: response.total }));
            }

            return of(
              loadPresentationsBatch({
                offset: BATCH_SIZE,
                accumulatedPresentations: presentations,
                total: response.total,
              }),
            );
          }),
          catchError((error) => of(loadPresentationsFailure({ error: normalizeError(error) }))),
        );
      }),
    );
  },
  { functional: true },
);

export const loadPresentationsBatch$ = createEffect(
  (actions$ = inject(Actions), presentationsService = inject(PresentationsService)) => {
    return actions$.pipe(
      ofType(loadPresentationsBatch),
      switchMap(({ offset, accumulatedPresentations, total }) => {
        const batchParams = { limit: BATCH_SIZE, offset };

        return presentationsService.listPresentations(batchParams).pipe(
          switchMap((response) => {
            const newAccumulated = [...accumulatedPresentations, ...response.items];

            if (response.items.length === 0 || newAccumulated.length >= total) {
              return of(loadPresentationsSuccess({ presentations: newAccumulated, total }));
            }

            if (response.items.length < BATCH_SIZE) {
              return of(loadPresentationsSuccess({ presentations: newAccumulated, total }));
            }

            return of(
              loadPresentationsBatch({
                offset: offset + BATCH_SIZE,
                accumulatedPresentations: newAccumulated,
                total,
              }),
            );
          }),
          catchError((error) => of(loadPresentationsFailure({ error: normalizeError(error) }))),
        );
      }),
    );
  },
  { functional: true },
);

export const loadPresentation$ = createEffect(
  (actions$ = inject(Actions), presentationsService = inject(PresentationsService)) => {
    return actions$.pipe(
      ofType(loadPresentation),
      switchMap(({ id }) =>
        presentationsService.getPresentation(id).pipe(
          map((presentation) => loadPresentationSuccess({ presentation })),
          catchError((error) => of(loadPresentationFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const createPresentation$ = createEffect(
  (actions$ = inject(Actions), presentationsService = inject(PresentationsService)) => {
    return actions$.pipe(
      ofType(createPresentation),
      exhaustMap(({ dto }) =>
        presentationsService.createPresentation(dto).pipe(
          map((presentation) => createPresentationSuccess({ presentation })),
          catchError((error) => of(createPresentationFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const updatePresentation$ = createEffect(
  (actions$ = inject(Actions), presentationsService = inject(PresentationsService)) => {
    return actions$.pipe(
      ofType(updatePresentation),
      exhaustMap(({ id, dto }) =>
        presentationsService.updatePresentation(id, dto).pipe(
          map((presentation) => updatePresentationSuccess({ presentation })),
          catchError((error) => of(updatePresentationFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const importPresentationMarkdown$ = createEffect(
  (actions$ = inject(Actions), presentationsService = inject(PresentationsService)) => {
    return actions$.pipe(
      ofType(importPresentationMarkdown),
      exhaustMap(({ id, dto }) =>
        presentationsService.importMarkdown(id, dto).pipe(
          map((presentation) => importPresentationMarkdownSuccess({ presentation })),
          catchError((error) => of(importPresentationMarkdownFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const deletePresentation$ = createEffect(
  (actions$ = inject(Actions), presentationsService = inject(PresentationsService)) => {
    return actions$.pipe(
      ofType(deletePresentation),
      exhaustMap(({ id }) =>
        presentationsService.deletePresentation(id).pipe(
          map(() => deletePresentationSuccess({ id })),
          catchError((error) => of(deletePresentationFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);
