import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, map, of, switchMap } from 'rxjs';

import { AdminProjectsService } from '../../services/admin-projects.service';
import { ProjectsService } from '../../services/projects.service';

import {
  billProjectTime,
  billProjectTimeFailure,
  billProjectTimeSuccess,
  createAdminProject,
  createAdminProjectFailure,
  createAdminProjectSuccess,
  deleteAdminProject,
  deleteAdminProjectFailure,
  deleteAdminProjectSuccess,
  loadAdminProjectDetail,
  loadAdminProjectDetailFailure,
  loadAdminProjectDetailSuccess,
  loadAdminProjects,
  loadAdminProjectsBatch,
  loadAdminProjectsFailure,
  loadAdminProjectsSuccess,
  loadProjectDetail,
  loadProjectDetailFailure,
  loadProjectDetailSuccess,
  loadProjects,
  loadProjectsBatch,
  loadProjectsFailure,
  loadProjectsSuccess,
  loadProjectSummary,
  loadProjectSummaryFailure,
  loadProjectSummarySuccess,
  updateAdminProject,
  updateAdminProjectFailure,
  updateAdminProjectSuccess,
} from './projects.actions';

function normalizeError(error: unknown): string {
  if (error instanceof Error) return error.message;

  if (typeof error === 'string') return error;

  if (error && typeof error === 'object' && 'message' in error) return String(error.message);

  return 'An unexpected error occurred';
}

const BATCH_SIZE = 10;

export const loadProjects$ = createEffect(
  (actions$ = inject(Actions), service = inject(ProjectsService)) =>
    actions$.pipe(
      ofType(loadProjects),
      switchMap(() =>
        service.list({ limit: BATCH_SIZE, offset: 0 }).pipe(
          switchMap((response) => {
            if (response.items.length === 0) return of(loadProjectsSuccess({ projects: [] }));

            if (response.items.length < BATCH_SIZE) return of(loadProjectsSuccess({ projects: response.items }));

            return of(loadProjectsBatch({ offset: BATCH_SIZE, accumulatedProjects: response.items }));
          }),
          catchError((error) => of(loadProjectsFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const loadProjectsBatch$ = createEffect(
  (actions$ = inject(Actions), service = inject(ProjectsService)) =>
    actions$.pipe(
      ofType(loadProjectsBatch),
      switchMap(({ offset, accumulatedProjects }) =>
        service.list({ limit: BATCH_SIZE, offset }).pipe(
          switchMap((response) => {
            const newAccumulated = [...accumulatedProjects, ...response.items];

            if (response.items.length === 0 || response.items.length < BATCH_SIZE) {
              return of(loadProjectsSuccess({ projects: newAccumulated }));
            }

            return of(loadProjectsBatch({ offset: offset + BATCH_SIZE, accumulatedProjects: newAccumulated }));
          }),
          catchError((error) => of(loadProjectsFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const loadProjectDetail$ = createEffect(
  (actions$ = inject(Actions), service = inject(ProjectsService)) =>
    actions$.pipe(
      ofType(loadProjectDetail),
      switchMap(({ projectId }) =>
        service.getById(projectId).pipe(
          map((project) => loadProjectDetailSuccess({ project })),
          catchError((error) => of(loadProjectDetailFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const loadProjectSummary$ = createEffect(
  (actions$ = inject(Actions), service = inject(ProjectsService)) =>
    actions$.pipe(
      ofType(loadProjectSummary),
      switchMap(({ projectId }) =>
        service.getSummary(projectId).pipe(
          map((summary) => loadProjectSummarySuccess({ summary })),
          catchError((error) => of(loadProjectSummaryFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const loadAdminProjects$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminProjectsService)) =>
    actions$.pipe(
      ofType(loadAdminProjects),
      switchMap(() =>
        service.list({ limit: BATCH_SIZE, offset: 0 }).pipe(
          switchMap((response) => {
            if (response.items.length === 0) return of(loadAdminProjectsSuccess({ adminProjects: [] }));

            if (response.items.length < BATCH_SIZE) {
              return of(loadAdminProjectsSuccess({ adminProjects: response.items }));
            }

            return of(loadAdminProjectsBatch({ offset: BATCH_SIZE, accumulatedProjects: response.items }));
          }),
          catchError((error) => of(loadAdminProjectsFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const loadAdminProjectsBatch$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminProjectsService)) =>
    actions$.pipe(
      ofType(loadAdminProjectsBatch),
      switchMap(({ offset, accumulatedProjects }) =>
        service.list({ limit: BATCH_SIZE, offset }).pipe(
          switchMap((response) => {
            const newAccumulated = [...accumulatedProjects, ...response.items];

            if (response.items.length === 0 || response.items.length < BATCH_SIZE) {
              return of(loadAdminProjectsSuccess({ adminProjects: newAccumulated }));
            }

            return of(loadAdminProjectsBatch({ offset: offset + BATCH_SIZE, accumulatedProjects: newAccumulated }));
          }),
          catchError((error) => of(loadAdminProjectsFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const loadAdminProjectDetail$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminProjectsService)) =>
    actions$.pipe(
      ofType(loadAdminProjectDetail),
      switchMap(({ projectId }) =>
        service.getById(projectId).pipe(
          map((project) => loadAdminProjectDetailSuccess({ project })),
          catchError((error) => of(loadAdminProjectDetailFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const createAdminProject$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminProjectsService)) =>
    actions$.pipe(
      ofType(createAdminProject),
      switchMap(({ dto }) =>
        service.create(dto).pipe(
          map((project) => createAdminProjectSuccess({ project })),
          catchError((error) => of(createAdminProjectFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const updateAdminProject$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminProjectsService)) =>
    actions$.pipe(
      ofType(updateAdminProject),
      switchMap(({ projectId, dto }) =>
        service.update(projectId, dto).pipe(
          map((project) => updateAdminProjectSuccess({ project })),
          catchError((error) => of(updateAdminProjectFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const deleteAdminProject$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminProjectsService)) =>
    actions$.pipe(
      ofType(deleteAdminProject),
      switchMap(({ projectId }) =>
        service.delete(projectId).pipe(
          map(() => deleteAdminProjectSuccess({ projectId })),
          catchError((error) => of(deleteAdminProjectFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const billProjectTime$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminProjectsService)) =>
    actions$.pipe(
      ofType(billProjectTime),
      switchMap(({ projectId }) =>
        service.billTime(projectId).pipe(
          switchMap((result) => of(billProjectTimeSuccess({ projectId, result }), loadProjectSummary({ projectId }))),
          catchError((error) => of(billProjectTimeFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);
