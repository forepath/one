import { createAction, props } from '@ngrx/store';

import type { Plan, PlanListQuery } from '../../types/plans.types';

export type PlanAction = 'approve' | 'apply' | 'cancel' | 'discard';

export const loadPlans = createAction('[ConsolePlans] Load', props<{ query: PlanListQuery; silent?: boolean }>());
export const loadPlansSuccess = createAction('[ConsolePlans] Load Success', props<{ plans: Plan[] }>());
export const loadPlansFailure = createAction('[ConsolePlans] Load Failure', props<{ error: string }>());

export const loadPlan = createAction('[ConsolePlans] Load Plan', props<{ id: string; silent?: boolean }>());
export const loadPlanSuccess = createAction('[ConsolePlans] Load Plan Success', props<{ plan: Plan }>());
export const loadPlanFailure = createAction('[ConsolePlans] Load Plan Failure', props<{ id: string; error: string }>());

export const approvePlan = createAction('[ConsolePlans] Approve', props<{ id: string }>());
/** `confirm`: confirms the plan's unacknowledged pins. */
export const applyPlan = createAction('[ConsolePlans] Apply', props<{ id: string; confirm: boolean }>());
export const cancelPlan = createAction('[ConsolePlans] Cancel', props<{ id: string }>());
export const discardPlan = createAction('[ConsolePlans] Discard', props<{ id: string }>());
export const planActionSuccess = createAction(
  '[ConsolePlans] Action Success',
  props<{ action: PlanAction; plan: Plan }>(),
);
export const planActionFailure = createAction(
  '[ConsolePlans] Action Failure',
  props<{ action: PlanAction; id: string; error: string }>(),
);
export const clearPlanActionError = createAction('[ConsolePlans] Clear Action Error');

/** Live plans over `socket/plans` while a plans view is open. */
export const connectPlansLive = createAction('[ConsolePlans] Live Connect');
export const disconnectPlansLive = createAction('[ConsolePlans] Live Disconnect');
export const plansLiveConnected = createAction('[ConsolePlans] Live Connected', props<{ connected: boolean }>());
export const plansSnapshotReceived = createAction('[ConsolePlans] Live Snapshot', props<{ plans: Plan[] }>());
export const planPatched = createAction('[ConsolePlans] Live Patch', props<{ plan: Plan }>());
