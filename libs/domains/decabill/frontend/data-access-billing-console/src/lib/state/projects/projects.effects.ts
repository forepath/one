import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, map, of, switchMap } from 'rxjs';

import { billingPageWindow } from '../../constants/list-paging.constants';
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
  loadAdminProjectsFailure,
  loadAdminProjectsSuccess,
  loadProjectDetail,
  loadProjectDetailFailure,
  loadProjectDetailSuccess,
  loadProjects,
  loadProjectsCatalogSummary,
  loadProjectsCatalogSummaryFailure,
  loadProjectsCatalogSummarySuccess,
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

export const loadProjects$ = createEffect(
  (actions$ = inject(Actions), service = inject(ProjectsService)) =>
    actions$.pipe(
      ofType(loadProjects),
      switchMap(({ search, page, pageSize }) => {
        const { limit, offset } = billingPageWindow(page, pageSize);

        return service.list({ limit, offset, search }).pipe(
          map((response) => loadProjectsSuccess({ projects: response.items, total: response.total })),
          catchError((error) => of(loadProjectsFailure({ error: normalizeError(error) }))),
        );
      }),
    ),
  { functional: true },
);

export const loadProjectsCatalogSummary$ = createEffect(
  (actions$ = inject(Actions), service = inject(ProjectsService)) =>
    actions$.pipe(
      ofType(loadProjectsCatalogSummary),
      switchMap(() =>
        service.getCatalogSummary().pipe(
          map((summary) => loadProjectsCatalogSummarySuccess({ summary })),
          catchError((error) => of(loadProjectsCatalogSummaryFailure({ error: normalizeError(error) }))),
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
      switchMap(({ search, userId, page, pageSize }) => {
        const { limit, offset } = billingPageWindow(page, pageSize);

        return service.list({ limit, offset, search, userId }).pipe(
          map((response) => loadAdminProjectsSuccess({ adminProjects: response.items, total: response.total })),
          catchError((error) => of(loadAdminProjectsFailure({ error: normalizeError(error) }))),
        );
      }),
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
      switchMap(({ projectId, dto }) =>
        service.billTime(projectId, dto).pipe(
          switchMap((result) => of(billProjectTimeSuccess({ projectId, result }), loadProjectSummary({ projectId }))),
          catchError((error) => of(billProjectTimeFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);
