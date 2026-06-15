import { HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, forkJoin, map, of, switchMap } from 'rxjs';

import { TicketsService } from '../../services/tickets.service';

import {
  addTicketComment,
  addTicketCommentFailure,
  addTicketCommentSuccess,
  createTicket,
  createTicketFailure,
  createTicketSuccess,
  deleteTicket,
  deleteTicketFailure,
  deleteTicketSuccess,
  loadTicketDetailBundleSuccess,
  loadTicketDetailFailure,
  loadTickets,
  loadTicketsFailure,
  loadTicketsSuccess,
  migrateTicket,
  migrateTicketFailure,
  migrateTicketSuccess,
  openTicketDetail,
  updateTicket,
  updateTicketFailure,
  updateTicketSuccess,
} from './tickets.actions';
import type { TicketActivityResponseDto, TicketResponseDto } from './tickets.types';

function normalizeError(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    return error.error?.message ?? error.message ?? String(error.status);
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'An unexpected error occurred';
}

function collectTicketTreeIds(root: TicketResponseDto): string[] {
  const ids = [root.id];

  for (const c of root.children ?? []) {
    ids.push(...collectTicketTreeIds(c));
  }

  return ids;
}

export const loadTickets$ = createEffect(
  (actions$ = inject(Actions), ticketsService = inject(TicketsService)) => {
    return actions$.pipe(
      ofType(loadTickets),
      switchMap(({ params }) =>
        ticketsService.listTickets(params).pipe(
          map((tickets) => loadTicketsSuccess({ tickets })),
          catchError((error) => of(loadTicketsFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const openTicketDetail$ = createEffect(
  (actions$ = inject(Actions), ticketsService = inject(TicketsService)) => {
    return actions$.pipe(
      ofType(openTicketDetail),
      switchMap(({ id }) =>
        forkJoin({
          ticket: ticketsService.getTicket(id, true),
          comments: ticketsService.listComments(id),
          activity: ticketsService.listActivity(id, 100, 0),
        }).pipe(
          map(({ ticket, comments, activity }) => loadTicketDetailBundleSuccess({ ticket, comments, activity })),
          catchError((error) => of(loadTicketDetailFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const createTicket$ = createEffect(
  (actions$ = inject(Actions), ticketsService = inject(TicketsService)) => {
    return actions$.pipe(
      ofType(createTicket),
      switchMap(({ dto }) =>
        ticketsService.createTicket(dto).pipe(
          map((res) => {
            const { createdChildTickets, ...ticket } = res;

            return createTicketSuccess({
              ticket,
              ...(createdChildTickets?.length ? { createdChildTickets } : {}),
            });
          }),
          catchError((error) => of(createTicketFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const updateTicket$ = createEffect(
  (actions$ = inject(Actions), ticketsService = inject(TicketsService)) => {
    return actions$.pipe(
      ofType(updateTicket),
      switchMap(({ id, dto }) =>
        ticketsService.updateTicket(id, dto).pipe(
          switchMap((ticket) =>
            forkJoin({
              ticket: of(ticket),
              activity: ticketsService
                .listActivity(id, 100, 0)
                .pipe(catchError(() => of([] as TicketActivityResponseDto[]))),
            }).pipe(map(({ ticket: t, activity }) => updateTicketSuccess({ ticket: t, activity }))),
          ),
          catchError((error) => of(updateTicketFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const migrateTicket$ = createEffect(
  (actions$ = inject(Actions), ticketsService = inject(TicketsService)) => {
    return actions$.pipe(
      ofType(migrateTicket),
      switchMap(({ id, targetClientId }) =>
        ticketsService.migrateTicket(id, { targetClientId }).pipe(
          map((res) =>
            migrateTicketSuccess({
              rootTicket: res.ticket,
              migratedTicketIds: collectTicketTreeIds(res.ticket),
              requestedTicketId: id,
            }),
          ),
          catchError((error) => of(migrateTicketFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const deleteTicket$ = createEffect(
  (actions$ = inject(Actions), ticketsService = inject(TicketsService)) => {
    return actions$.pipe(
      ofType(deleteTicket),
      switchMap(({ id, releaseExternalSyncMarker }) =>
        ticketsService.deleteTicket(id, releaseExternalSyncMarker).pipe(
          map(() => deleteTicketSuccess({ id })),
          catchError((error) => of(deleteTicketFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const addTicketComment$ = createEffect(
  (actions$ = inject(Actions), ticketsService = inject(TicketsService)) => {
    return actions$.pipe(
      ofType(addTicketComment),
      switchMap(({ ticketId, body }) =>
        ticketsService.addComment(ticketId, body).pipe(
          switchMap((comment) =>
            forkJoin({
              comment: of(comment),
              activity: ticketsService
                .listActivity(ticketId, 100, 0)
                .pipe(catchError(() => of([] as TicketActivityResponseDto[]))),
            }).pipe(map(({ comment: c, activity }) => addTicketCommentSuccess({ comment: c, activity }))),
          ),
          catchError((error) => of(addTicketCommentFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);
