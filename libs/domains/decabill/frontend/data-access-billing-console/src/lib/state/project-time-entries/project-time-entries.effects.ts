import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, map, of, switchMap } from 'rxjs';

import { ProjectTimeEntriesService } from '../../services/project-time-entries.service';
import { loadProjectSummary } from '../projects/projects.actions';

import {
  createProjectTimeEntry,
  createProjectTimeEntryFailure,
  createProjectTimeEntrySuccess,
  deleteProjectTimeEntry,
  deleteProjectTimeEntryFailure,
  deleteProjectTimeEntrySuccess,
  loadProjectTimeEntries,
  loadProjectTimeEntriesBatch,
  loadProjectTimeEntriesFailure,
  loadProjectTimeEntriesSuccess,
  updateProjectTimeEntry,
  updateProjectTimeEntryFailure,
  updateProjectTimeEntrySuccess,
} from './project-time-entries.actions';

function normalizeError(error: unknown): string {
  if (error instanceof Error) return error.message;

  if (typeof error === 'string') return error;

  if (error && typeof error === 'object' && 'message' in error) return String(error.message);

  return 'An unexpected error occurred';
}

const BATCH_SIZE = 10;

export const loadProjectTimeEntries$ = createEffect(
  (actions$ = inject(Actions), service = inject(ProjectTimeEntriesService)) =>
    actions$.pipe(
      ofType(loadProjectTimeEntries),
      switchMap(({ projectId }) =>
        service.list(projectId, { limit: BATCH_SIZE, offset: 0 }).pipe(
          switchMap((response) => {
            if (response.items.length === 0) return of(loadProjectTimeEntriesSuccess({ entries: [] }));

            if (response.items.length < BATCH_SIZE) {
              return of(loadProjectTimeEntriesSuccess({ entries: response.items }));
            }

            return of(
              loadProjectTimeEntriesBatch({
                projectId,
                offset: BATCH_SIZE,
                accumulatedEntries: response.items,
              }),
            );
          }),
          catchError((error) => of(loadProjectTimeEntriesFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const loadProjectTimeEntriesBatch$ = createEffect(
  (actions$ = inject(Actions), service = inject(ProjectTimeEntriesService)) =>
    actions$.pipe(
      ofType(loadProjectTimeEntriesBatch),
      switchMap(({ projectId, offset, accumulatedEntries }) =>
        service.list(projectId, { limit: BATCH_SIZE, offset }).pipe(
          switchMap((response) => {
            const newAccumulated = [...accumulatedEntries, ...response.items];

            if (response.items.length === 0 || response.items.length < BATCH_SIZE) {
              return of(loadProjectTimeEntriesSuccess({ entries: newAccumulated }));
            }

            return of(
              loadProjectTimeEntriesBatch({
                projectId,
                offset: offset + BATCH_SIZE,
                accumulatedEntries: newAccumulated,
              }),
            );
          }),
          catchError((error) => of(loadProjectTimeEntriesFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const createProjectTimeEntry$ = createEffect(
  (actions$ = inject(Actions), service = inject(ProjectTimeEntriesService)) =>
    actions$.pipe(
      ofType(createProjectTimeEntry),
      switchMap(({ projectId, dto }) =>
        service.create(projectId, dto).pipe(
          switchMap((entry) =>
            of(createProjectTimeEntrySuccess({ entry }), loadProjectSummary({ projectId: entry.projectId })),
          ),
          catchError((error) => of(createProjectTimeEntryFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const updateProjectTimeEntry$ = createEffect(
  (actions$ = inject(Actions), service = inject(ProjectTimeEntriesService)) =>
    actions$.pipe(
      ofType(updateProjectTimeEntry),
      switchMap(({ projectId, id, dto }) =>
        service.update(projectId, id, dto).pipe(
          switchMap((entry) =>
            of(updateProjectTimeEntrySuccess({ entry }), loadProjectSummary({ projectId: entry.projectId })),
          ),
          catchError((error) => of(updateProjectTimeEntryFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const deleteProjectTimeEntry$ = createEffect(
  (actions$ = inject(Actions), service = inject(ProjectTimeEntriesService)) =>
    actions$.pipe(
      ofType(deleteProjectTimeEntry),
      switchMap(({ projectId, id }) =>
        service.delete(projectId, id).pipe(
          switchMap(() => of(deleteProjectTimeEntrySuccess({ id, projectId }), loadProjectSummary({ projectId }))),
          catchError((error) => of(deleteProjectTimeEntryFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);
