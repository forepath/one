import { HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, concatMap, map, mergeMap, of, switchMap } from 'rxjs';

import { ChatPlansService } from '../../services/chat-plans.service';

import {
  loadChatPlan,
  loadChatPlanActivity,
  loadChatPlanActivityFailure,
  loadChatPlanActivitySuccess,
  loadChatPlanFailure,
  loadChatPlans,
  loadChatPlansFailure,
  loadChatPlansSuccess,
  loadChatPlanSuccess,
  updateChatPlan,
  updateChatPlanFailure,
  updateChatPlanSuccess,
} from './chat-plans.actions';

/** Activity rows loaded for the opened plan (newest first). */
export const CHAT_PLAN_ACTIVITY_PAGE_SIZE = 200;

function normalizeError(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    const message = error.error?.message;

    if (Array.isArray(message)) {
      return message.join('; ');
    }

    return message ?? error.message ?? String(error.status);
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'An unexpected error occurred';
}

export const loadChatPlans$ = createEffect(
  (actions$ = inject(Actions), service = inject(ChatPlansService)) =>
    actions$.pipe(
      ofType(loadChatPlans),
      switchMap(({ clientId, agentId, query }) =>
        service.listPlans(clientId, agentId, query).pipe(
          map(({ items, total }) => loadChatPlansSuccess({ clientId, agentId, plans: items, total })),
          catchError((error) => of(loadChatPlansFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const loadChatPlan$ = createEffect(
  (actions$ = inject(Actions), service = inject(ChatPlansService)) =>
    actions$.pipe(
      ofType(loadChatPlan),
      switchMap(({ clientId, agentId, planId }) =>
        service.getPlan(clientId, agentId, planId).pipe(
          map((plan) => loadChatPlanSuccess({ plan })),
          catchError((error) => of(loadChatPlanFailure({ planId, error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const updateChatPlan$ = createEffect(
  (actions$ = inject(Actions), service = inject(ChatPlansService)) =>
    actions$.pipe(
      ofType(updateChatPlan),
      concatMap(({ clientId, agentId, planId, dto }) =>
        service.updatePlan(clientId, agentId, planId, dto).pipe(
          map((plan) => updateChatPlanSuccess({ plan })),
          catchError((error) =>
            of(
              updateChatPlanFailure({
                error: normalizeError(error),
                conflict: error instanceof HttpErrorResponse && error.status === 409,
              }),
            ),
          ),
        ),
      ),
    ),
  { functional: true },
);

/** A saved edit is the newest activity row: reload the opened plan's log. */
export const reloadChatPlanActivityAfterUpdate$ = createEffect(
  (actions$ = inject(Actions)) =>
    actions$.pipe(
      ofType(updateChatPlanSuccess),
      map(({ plan }) => loadChatPlanActivity({ clientId: plan.clientId, agentId: plan.agentId, planId: plan.id })),
    ),
  { functional: true },
);

export const loadChatPlanActivity$ = createEffect(
  (actions$ = inject(Actions), service = inject(ChatPlansService)) =>
    actions$.pipe(
      ofType(loadChatPlanActivity),
      mergeMap(({ clientId, agentId, planId }) =>
        service.listActivity(clientId, agentId, planId, { limit: CHAT_PLAN_ACTIVITY_PAGE_SIZE }).pipe(
          map((activity) => loadChatPlanActivitySuccess({ planId, activity })),
          catchError((error) => of(loadChatPlanActivityFailure({ planId, error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);
