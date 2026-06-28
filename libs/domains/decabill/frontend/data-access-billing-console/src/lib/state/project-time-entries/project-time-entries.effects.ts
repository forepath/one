import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { catchError, filter, map, of, switchMap, withLatestFrom } from 'rxjs';

import { ProjectTimeEntriesService } from '../../services/project-time-entries.service';
import type { ProjectTimeEntryResponse } from '../../types/projects.types';
import { loadProjectSummary } from '../projects/projects.actions';
import { closeProjectTicketDetail, openProjectTicketDetail } from '../project-tickets/project-tickets.actions';
import { selectProjectTicketsProjectId } from '../project-tickets/project-tickets.selectors';

import {
  clearProjectTicketTimeEntries,
  createProjectTimeEntry,
  createProjectTimeEntryFailure,
  createProjectTimeEntrySuccess,
  deleteProjectTimeEntry,
  deleteProjectTimeEntryFailure,
  deleteProjectTimeEntrySuccess,
  loadProjectTicketTimeEntries,
  loadProjectTicketTimeEntriesBatch,
  loadProjectTicketTimeEntriesFailure,
  loadProjectTicketTimeEntriesSuccess,
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

function loadTicketTimeEntriesBatchChain(
  service: ProjectTimeEntriesService,
  projectId: string,
  ticketId: string,
  offset: number,
  accumulatedEntries: ProjectTimeEntryResponse[],
) {
  return service.list(projectId, { limit: BATCH_SIZE, offset, ticketId }).pipe(
    switchMap((response) => {
      const newAccumulated = [...accumulatedEntries, ...response.items];

      if (response.items.length === 0 || response.items.length < BATCH_SIZE) {
        return of(loadProjectTicketTimeEntriesSuccess({ entries: newAccumulated }));
      }

      return of(
        loadProjectTicketTimeEntriesBatch({
          projectId,
          ticketId,
          offset: offset + BATCH_SIZE,
          accumulatedEntries: newAccumulated,
        }),
      );
    }),
    catchError((error) => of(loadProjectTicketTimeEntriesFailure({ error: normalizeError(error) }))),
  );
}

export const loadProjectTicketTimeEntries$ = createEffect(
  (actions$ = inject(Actions), service = inject(ProjectTimeEntriesService)) =>
    actions$.pipe(
      ofType(loadProjectTicketTimeEntries),
      switchMap(({ projectId, ticketId }) =>
        service.list(projectId, { limit: BATCH_SIZE, offset: 0, ticketId }).pipe(
          switchMap((response) => {
            if (response.items.length === 0) {
              return of(loadProjectTicketTimeEntriesSuccess({ entries: [] }));
            }

            if (response.items.length < BATCH_SIZE) {
              return of(loadProjectTicketTimeEntriesSuccess({ entries: response.items }));
            }

            return of(
              loadProjectTicketTimeEntriesBatch({
                projectId,
                ticketId,
                offset: BATCH_SIZE,
                accumulatedEntries: response.items,
              }),
            );
          }),
          catchError((error) => of(loadProjectTicketTimeEntriesFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const loadProjectTicketTimeEntriesBatch$ = createEffect(
  (actions$ = inject(Actions), service = inject(ProjectTimeEntriesService)) =>
    actions$.pipe(
      ofType(loadProjectTicketTimeEntriesBatch),
      switchMap(({ projectId, ticketId, offset, accumulatedEntries }) =>
        loadTicketTimeEntriesBatchChain(service, projectId, ticketId, offset, accumulatedEntries),
      ),
    ),
  { functional: true },
);

export const loadProjectTicketTimeEntriesOnDetailOpen$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store)) =>
    actions$.pipe(
      ofType(openProjectTicketDetail),
      withLatestFrom(store.select(selectProjectTicketsProjectId)),
      filter(([, projectId]) => projectId != null && projectId !== ''),
      map(([{ id }, projectId]) => loadProjectTicketTimeEntries({ projectId: projectId!, ticketId: id })),
    ),
  { functional: true },
);

export const clearProjectTicketTimeEntriesOnDetailClose$ = createEffect(
  (actions$ = inject(Actions)) =>
    actions$.pipe(
      ofType(closeProjectTicketDetail),
      map(() => clearProjectTicketTimeEntries()),
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
