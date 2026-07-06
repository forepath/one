import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { DEFAULT_STARTER_MARKDOWN, isGuestEditorPresentationId } from '@forepath/marpdown/marpdown/shared';
import { catchError, exhaustMap, filter, map, of, switchMap, withLatestFrom } from 'rxjs';

import { PresentationsService } from '../../services/presentations.service';

import {
  closeEditor,
  importEditorFailure,
  importEditorMarkdown,
  importEditorSuccess,
  openEditor,
  resetEditorMarkdown,
  saveEditor,
  saveEditorFailure,
  saveEditorSuccess,
} from './editor.actions';
import { selectEditorMarkdown, selectEditorPresentationId } from './editor.selectors';
import { loadPresentation } from '../presentations/presentations.actions';

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

export const openEditor$ = createEffect(
  (actions$ = inject(Actions)) => {
    return actions$.pipe(
      ofType(openEditor),
      filter(({ presentationId }) => !isGuestEditorPresentationId(presentationId)),
      map(({ presentationId }) => loadPresentation({ id: presentationId })),
    );
  },
  { functional: true },
);

export const openGuestEditor$ = createEffect(
  (actions$ = inject(Actions)) => {
    return actions$.pipe(
      ofType(openEditor),
      filter(({ presentationId }) => isGuestEditorPresentationId(presentationId)),
      map(() => resetEditorMarkdown({ markdown: DEFAULT_STARTER_MARKDOWN })),
    );
  },
  { functional: true },
);

export const saveEditor$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store), presentationsService = inject(PresentationsService)) => {
    return actions$.pipe(
      ofType(saveEditor),
      withLatestFrom(store.select(selectEditorPresentationId), store.select(selectEditorMarkdown)),
      exhaustMap(([, presentationId, markdown]) => {
        if (!presentationId || isGuestEditorPresentationId(presentationId)) {
          return of(saveEditorFailure({ error: 'No presentation selected' }));
        }

        return presentationsService.updatePresentation(presentationId, { markdown }).pipe(
          map((presentation) => saveEditorSuccess({ markdown: presentation.markdown })),
          catchError((error) => of(saveEditorFailure({ error: normalizeError(error) }))),
        );
      }),
    );
  },
  { functional: true },
);

export const importEditorMarkdown$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store), presentationsService = inject(PresentationsService)) => {
    return actions$.pipe(
      ofType(importEditorMarkdown),
      withLatestFrom(store.select(selectEditorPresentationId)),
      exhaustMap(([{ markdown }, presentationId]) => {
        if (!presentationId || isGuestEditorPresentationId(presentationId)) {
          return of(importEditorFailure({ error: 'No presentation selected' }));
        }

        return presentationsService.importMarkdown(presentationId, { markdown }).pipe(
          map((presentation) => importEditorSuccess({ markdown: presentation.markdown })),
          catchError((error) => of(importEditorFailure({ error: normalizeError(error) }))),
        );
      }),
    );
  },
  { functional: true },
);

export const closeEditorOnNavigate$ = createEffect(
  (actions$ = inject(Actions)) => {
    return actions$.pipe(ofType(closeEditor));
  },
  { functional: true, dispatch: false },
);
