import { HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { catchError, filter, forkJoin, map, of, switchMap, withLatestFrom } from 'rxjs';

import { ProjectTicketsService } from '../../services/project-tickets.service';

import {
  addProjectTicketComment,
  addProjectTicketCommentFailure,
  addProjectTicketCommentSuccess,
  createProjectTicket,
  createProjectTicketFailure,
  createProjectTicketSuccess,
  deleteProjectTicket,
  deleteProjectTicketFailure,
  deleteProjectTicketSuccess,
  loadProjectTicketDetailBundleSuccess,
  loadProjectTicketDetailFailure,
  loadProjectTickets,
  loadProjectTicketsFailure,
  loadProjectTicketsSuccess,
  openProjectTicketDetail,
  updateProjectTicket,
  updateProjectTicketFailure,
  updateProjectTicketSuccess,
} from './project-tickets.actions';
import { selectProjectTicketsProjectId } from './project-tickets.selectors';
import type { ProjectTicketActivityResponse } from '../../types/projects.types';

function normalizeError(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    return error.error?.message ?? error.message ?? String(error.status);
  }

  if (error instanceof Error) return error.message;

  if (typeof error === 'string') return error;

  return 'An unexpected error occurred';
}

export const loadProjectTickets$ = createEffect(
  (actions$ = inject(Actions), service = inject(ProjectTicketsService)) =>
    actions$.pipe(
      ofType(loadProjectTickets),
      switchMap(({ params }) =>
        service.list(params).pipe(
          map((tickets) => loadProjectTicketsSuccess({ tickets })),
          catchError((error) => of(loadProjectTicketsFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const openProjectTicketDetail$ = createEffect(
  (actions$ = inject(Actions), service = inject(ProjectTicketsService), store = inject(Store)) =>
    actions$.pipe(
      ofType(openProjectTicketDetail),
      withLatestFrom(store.select(selectProjectTicketsProjectId)),
      filter(([, projectId]) => projectId != null && projectId !== ''),
      switchMap(([{ id }, projectId]) =>
        forkJoin({
          ticket: service.getById(projectId!, id, true),
          comments: service.listComments(projectId!, id),
          activity: service.listActivity(projectId!, id, 100, 0),
        }).pipe(
          map(({ ticket, comments, activity }) => loadProjectTicketDetailBundleSuccess({ ticket, comments, activity })),
          catchError((error) => of(loadProjectTicketDetailFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const createProjectTicket$ = createEffect(
  (actions$ = inject(Actions), service = inject(ProjectTicketsService)) =>
    actions$.pipe(
      ofType(createProjectTicket),
      switchMap(({ projectId, dto }) =>
        service.create(projectId, dto).pipe(
          map((ticket) => createProjectTicketSuccess({ ticket })),
          catchError((error) => of(createProjectTicketFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const updateProjectTicket$ = createEffect(
  (actions$ = inject(Actions), service = inject(ProjectTicketsService)) =>
    actions$.pipe(
      ofType(updateProjectTicket),
      switchMap(({ projectId, id, dto }) =>
        service.update(projectId, id, dto).pipe(
          switchMap((ticket) =>
            forkJoin({
              ticket: of(ticket),
              activity: service
                .listActivity(projectId, id, 100, 0)
                .pipe(catchError(() => of([] as ProjectTicketActivityResponse[]))),
            }).pipe(map(({ ticket: t, activity }) => updateProjectTicketSuccess({ ticket: t, activity }))),
          ),
          catchError((error) => of(updateProjectTicketFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const deleteProjectTicket$ = createEffect(
  (actions$ = inject(Actions), service = inject(ProjectTicketsService)) =>
    actions$.pipe(
      ofType(deleteProjectTicket),
      switchMap(({ projectId, id }) =>
        service.delete(projectId, id).pipe(
          map(() => deleteProjectTicketSuccess({ id })),
          catchError((error) => of(deleteProjectTicketFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const addProjectTicketComment$ = createEffect(
  (actions$ = inject(Actions), service = inject(ProjectTicketsService)) =>
    actions$.pipe(
      ofType(addProjectTicketComment),
      switchMap(({ projectId, ticketId, body }) =>
        service.addComment(projectId, ticketId, { body }).pipe(
          switchMap((comment) =>
            forkJoin({
              comment: of(comment),
              activity: service
                .listActivity(projectId, ticketId, 100, 0)
                .pipe(catchError(() => of([] as ProjectTicketActivityResponse[]))),
            }).pipe(map(({ comment: c, activity }) => addProjectTicketCommentSuccess({ comment: c, activity }))),
          ),
          catchError((error) => of(addProjectTicketCommentFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);
