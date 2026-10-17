import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store, type Action } from '@ngrx/store';
import { catchError, filter, from, map, mergeMap, Observable, of, switchMap, takeUntil, withLatestFrom } from 'rxjs';

import { PlansService } from '../../services/plans.service';
import { ConsoleSocketService } from '../../sockets/console-socket';
import type { Plan, PlanPatchEvent, PlansSnapshotEvent } from '../../types/plans.types';
import { apiErrorMessage } from '../../utils/api-error';
import {
  applyPlan,
  approvePlan,
  cancelPlan,
  connectPlansLive,
  discardPlan,
  disconnectPlansLive,
  loadPlan,
  loadPlanFailure,
  loadPlans,
  loadPlansFailure,
  loadPlansSuccess,
  loadPlanSuccess,
  planActionFailure,
  planActionSuccess,
  planPatched,
  plansLiveConnected,
  plansSnapshotReceived,
  type PlanAction,
} from './plans.actions';
import { selectSelectedPlanId } from './plans.selectors';

export const loadPlans$ = createEffect(
  (actions$ = inject(Actions), service = inject(PlansService)) =>
    actions$.pipe(
      ofType(loadPlans),
      switchMap(({ query }) =>
        service.list(query).pipe(
          map((plans) => loadPlansSuccess({ plans })),
          catchError((error: unknown) =>
            of(loadPlansFailure({ error: apiErrorMessage(error, 'Failed to load plans') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const loadPlan$ = createEffect(
  (actions$ = inject(Actions), service = inject(PlansService)) =>
    actions$.pipe(
      ofType(loadPlan),
      switchMap(({ id }) =>
        service.get(id).pipe(
          map((plan) => loadPlanSuccess({ plan })),
          catchError((error: unknown) =>
            of(loadPlanFailure({ id, error: apiErrorMessage(error, 'Failed to load the plan') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

function act(action: PlanAction, id: string, call: Observable<Plan>): Observable<Action> {
  return call.pipe(
    map((plan) => planActionSuccess({ action, plan })),
    catchError((error: unknown) =>
      of(planActionFailure({ action, id, error: apiErrorMessage(error, `Failed to ${action} the plan`) })),
    ),
  );
}

export const planActions$ = createEffect(
  (actions$ = inject(Actions), service = inject(PlansService)) =>
    actions$.pipe(
      ofType(approvePlan, applyPlan, cancelPlan, discardPlan),
      mergeMap((action) => {
        switch (action.type) {
          case approvePlan.type:
            return act('approve', action.id, service.approve(action.id));
          case applyPlan.type:
            return act('apply', action.id, service.apply(action.id, action.confirm));
          case cancelPlan.type:
            return act('cancel', action.id, service.cancel(action.id));
          default:
            return act('discard', action.id, service.discard(action.id));
        }
      }),
    ),
  { functional: true },
);

/** Approvals live only on the REST plan: an approval (or a failed action) re-reads the plan. */
export const reloadPlanAfterAction$ = createEffect(
  (actions$ = inject(Actions)) =>
    actions$.pipe(
      ofType(planActionSuccess, planActionFailure),
      map((action) => loadPlan({ id: 'plan' in action ? action.plan.id : action.id, silent: true })),
    ),
  { functional: true },
);

/**
 * `socket/plans`: `plansSnapshot` once on connect, then `planPatch` whenever a visible plan changes. The namespace
 * has no subscribe / unsubscribe messages: the socket is opened while a plans view is shown and closed after.
 */
export const plansLive$ = createEffect(
  (actions$ = inject(Actions), sockets = inject(ConsoleSocketService)) =>
    actions$.pipe(
      ofType(connectPlansLive),
      switchMap(() =>
        from(sockets.open('plans')).pipe(
          switchMap((socket) =>
            socket
              ? new Observable<Action>((subscriber) => {
                  socket.on('connect', () => subscriber.next(plansLiveConnected({ connected: true })));
                  socket.on('disconnect', () => subscriber.next(plansLiveConnected({ connected: false })));
                  socket.on('plansSnapshot', (event: PlansSnapshotEvent) =>
                    subscriber.next(plansSnapshotReceived({ plans: event?.plans ?? [] })),
                  );
                  socket.on('planPatch', (event: PlanPatchEvent) => {
                    if (event?.plan) subscriber.next(planPatched({ plan: event.plan }));
                  });

                  return () => {
                    socket.removeAllListeners();
                    socket.disconnect();
                  };
                })
              : of(plansLiveConnected({ connected: false })),
          ),
          catchError(() => of(plansLiveConnected({ connected: false }))),
          takeUntil(actions$.pipe(ofType(disconnectPlansLive))),
        ),
      ),
    ),
  { functional: true },
);

/** A patch of the open, still pending plan may be a new approval: the socket doesn't carry them, REST does. */
export const reloadSelectedPlanOnPatch$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store)) =>
    actions$.pipe(
      ofType(planPatched),
      withLatestFrom(store.select(selectSelectedPlanId)),
      filter(([{ plan }, selectedId]) => plan.status === 'pending' && plan.id === selectedId),
      map(([{ plan }]) => plan),
      map((plan) => loadPlan({ id: plan.id, silent: true })),
    ),
  { functional: true },
);
