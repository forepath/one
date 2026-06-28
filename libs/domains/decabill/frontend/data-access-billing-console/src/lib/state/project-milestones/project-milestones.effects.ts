import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, map, of, switchMap } from 'rxjs';

import { ProjectMilestonesService } from '../../services/project-milestones.service';

import {
  createProjectMilestone,
  createProjectMilestoneFailure,
  createProjectMilestoneSuccess,
  deleteProjectMilestone,
  deleteProjectMilestoneFailure,
  deleteProjectMilestoneSuccess,
  loadProjectMilestones,
  loadProjectMilestonesFailure,
  loadProjectMilestonesSuccess,
  lockProjectMilestone,
  lockProjectMilestoneFailure,
  lockProjectMilestoneSuccess,
  updateProjectMilestone,
  updateProjectMilestoneFailure,
  updateProjectMilestoneSuccess,
} from './project-milestones.actions';

function normalizeError(error: unknown): string {
  if (error instanceof Error) return error.message;

  if (typeof error === 'string') return error;

  if (error && typeof error === 'object' && 'message' in error) return String(error.message);

  return 'An unexpected error occurred';
}

export const loadProjectMilestones$ = createEffect(
  (actions$ = inject(Actions), service = inject(ProjectMilestonesService)) =>
    actions$.pipe(
      ofType(loadProjectMilestones),
      switchMap(({ projectId }) =>
        service.list(projectId).pipe(
          map((milestones) => loadProjectMilestonesSuccess({ milestones })),
          catchError((error) => of(loadProjectMilestonesFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const createProjectMilestone$ = createEffect(
  (actions$ = inject(Actions), service = inject(ProjectMilestonesService)) =>
    actions$.pipe(
      ofType(createProjectMilestone),
      switchMap(({ projectId, dto }) =>
        service.create(projectId, dto).pipe(
          map((milestone) => createProjectMilestoneSuccess({ milestone })),
          catchError((error) => of(createProjectMilestoneFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const updateProjectMilestone$ = createEffect(
  (actions$ = inject(Actions), service = inject(ProjectMilestonesService)) =>
    actions$.pipe(
      ofType(updateProjectMilestone),
      switchMap(({ projectId, id, dto }) =>
        service.update(projectId, id, dto).pipe(
          map((milestone) => updateProjectMilestoneSuccess({ milestone })),
          catchError((error) => of(updateProjectMilestoneFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const lockProjectMilestone$ = createEffect(
  (actions$ = inject(Actions), service = inject(ProjectMilestonesService)) =>
    actions$.pipe(
      ofType(lockProjectMilestone),
      switchMap(({ projectId, id }) =>
        service.lock(projectId, id).pipe(
          map((milestone) => lockProjectMilestoneSuccess({ milestone })),
          catchError((error) => of(lockProjectMilestoneFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const deleteProjectMilestone$ = createEffect(
  (actions$ = inject(Actions), service = inject(ProjectMilestonesService)) =>
    actions$.pipe(
      ofType(deleteProjectMilestone),
      switchMap(({ projectId, id }) =>
        service.delete(projectId, id).pipe(
          map(() => deleteProjectMilestoneSuccess({ id })),
          catchError((error) => of(deleteProjectMilestoneFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);
