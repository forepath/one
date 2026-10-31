import { createAction, props } from '@ngrx/store';

import type { DriftReport, ProposeDriftPlan } from '../../types/drift.types';
import type { Plan } from '../../types/plans.types';

export const loadDrift = createAction('[ConsoleDrift] Load', props<{ silent?: boolean }>());
export const loadDriftSuccess = createAction('[ConsoleDrift] Load Success', props<{ report: DriftReport }>());
export const loadDriftFailure = createAction('[ConsoleDrift] Load Failure', props<{ error: string }>());

/** Turns a foreign container into a proposed plan; on success the console opens the plan. */
export const proposeDriftPlan = createAction('[ConsoleDrift] Propose Plan', props<{ proposal: ProposeDriftPlan }>());
export const proposeDriftPlanSuccess = createAction('[ConsoleDrift] Propose Plan Success', props<{ plan: Plan }>());
export const proposeDriftPlanFailure = createAction('[ConsoleDrift] Propose Plan Failure', props<{ error: string }>());
export const clearDriftProposeError = createAction('[ConsoleDrift] Clear Propose Error');
