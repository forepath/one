import { HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, EMPTY, map, of, switchMap } from 'rxjs';

import { TicketsService } from '../../services/tickets.service';
import { replaceTicketDetailActivity } from '../tickets/tickets.actions';

import {
  approveTicketAutomation,
  approveTicketAutomationFailure,
  approveTicketAutomationSuccess,
  cancelTicketAutomationRun,
  cancelTicketAutomationRunFailure,
  cancelTicketAutomationRunSuccess,
  loadTicketAutomation,
  loadTicketAutomationFailure,
  loadTicketAutomationRunDetail,
  loadTicketAutomationRunDetailFailure,
  loadTicketAutomationRunDetailSuccess,
  loadTicketAutomationRuns,
  loadTicketAutomationRunsFailure,
  loadTicketAutomationRunsSuccess,
  loadTicketAutomationSuccess,
  patchTicketAutomation,
  patchTicketAutomationFailure,
  patchTicketAutomationSuccess,
  unapproveTicketAutomation,
  unapproveTicketAutomationFailure,
  unapproveTicketAutomationSuccess,
} from './ticket-automation.actions';

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

export const loadTicketAutomation$ = createEffect(
  (actions$ = inject(Actions), ticketsService = inject(TicketsService)) => {
    return actions$.pipe(
      ofType(loadTicketAutomation),
      switchMap(({ ticketId }) =>
        ticketsService.getTicketAutomation(ticketId).pipe(
          map((config) => loadTicketAutomationSuccess({ config })),
          catchError((error) => of(loadTicketAutomationFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const patchTicketAutomation$ = createEffect(
  (actions$ = inject(Actions), ticketsService = inject(TicketsService)) => {
    return actions$.pipe(
      ofType(patchTicketAutomation),
      switchMap(({ ticketId, dto }) =>
        ticketsService.patchTicketAutomation(ticketId, dto).pipe(
          map((config) => patchTicketAutomationSuccess({ config })),
          catchError((error) => of(patchTicketAutomationFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const approveTicketAutomation$ = createEffect(
  (actions$ = inject(Actions), ticketsService = inject(TicketsService)) => {
    return actions$.pipe(
      ofType(approveTicketAutomation),
      switchMap(({ ticketId }) =>
        ticketsService.approveTicketAutomation(ticketId).pipe(
          map((config) => approveTicketAutomationSuccess({ config })),
          catchError((error) => of(approveTicketAutomationFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const unapproveTicketAutomation$ = createEffect(
  (actions$ = inject(Actions), ticketsService = inject(TicketsService)) => {
    return actions$.pipe(
      ofType(unapproveTicketAutomation),
      switchMap(({ ticketId }) =>
        ticketsService.unapproveTicketAutomation(ticketId).pipe(
          map((config) => unapproveTicketAutomationSuccess({ config })),
          catchError((error) => of(unapproveTicketAutomationFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const loadTicketAutomationRuns$ = createEffect(
  (actions$ = inject(Actions), ticketsService = inject(TicketsService)) => {
    return actions$.pipe(
      ofType(loadTicketAutomationRuns),
      switchMap(({ ticketId }) =>
        ticketsService.listTicketAutomationRuns(ticketId).pipe(
          map((runs) => loadTicketAutomationRunsSuccess({ runs })),
          catchError((error) => of(loadTicketAutomationRunsFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const loadTicketAutomationRunDetail$ = createEffect(
  (actions$ = inject(Actions), ticketsService = inject(TicketsService)) => {
    return actions$.pipe(
      ofType(loadTicketAutomationRunDetail),
      switchMap(({ ticketId, runId }) =>
        ticketsService.getTicketAutomationRun(ticketId, runId).pipe(
          map((run) => loadTicketAutomationRunDetailSuccess({ run })),
          catchError((error) => of(loadTicketAutomationRunDetailFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const cancelTicketAutomationRun$ = createEffect(
  (actions$ = inject(Actions), ticketsService = inject(TicketsService)) => {
    return actions$.pipe(
      ofType(cancelTicketAutomationRun),
      switchMap(({ ticketId, runId }) =>
        ticketsService.cancelTicketAutomationRun(ticketId, runId).pipe(
          map((run) => cancelTicketAutomationRunSuccess({ run })),
          catchError((error) => of(cancelTicketAutomationRunFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

/** Keep ticket detail activity in sync after automation mutations (backend appends activity rows). */
export const refreshTicketDetailActivityAfterAutomation$ = createEffect(
  (actions$ = inject(Actions), ticketsService = inject(TicketsService)) => {
    return actions$.pipe(
      ofType(
        patchTicketAutomationSuccess,
        approveTicketAutomationSuccess,
        unapproveTicketAutomationSuccess,
        cancelTicketAutomationRunSuccess,
      ),
      switchMap((action) => {
        let ticketId: string | null = null;

        if (
          patchTicketAutomationSuccess.type === action.type ||
          approveTicketAutomationSuccess.type === action.type ||
          unapproveTicketAutomationSuccess.type === action.type
        ) {
          ticketId = action.config.ticketId;
        } else if (cancelTicketAutomationRunSuccess.type === action.type) {
          ticketId = action.run.ticketId;
        }

        if (!ticketId) {
          return EMPTY;
        }

        return ticketsService.listActivity(ticketId, 100, 0).pipe(
          map((activity) => replaceTicketDetailActivity({ ticketId, activity })),
          catchError(() => EMPTY),
        );
      }),
    );
  },
  { functional: true },
);
