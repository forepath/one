import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { ConsolePlansState } from './plans.reducer';

export const selectConsolePlansState = createFeatureSelector<ConsolePlansState>('consolePlans');

export const selectPlans = createSelector(selectConsolePlansState, (state) => state.plans);
export const selectPlansQuery = createSelector(selectConsolePlansState, (state) => state.query);
export const selectPlansLoading = createSelector(selectConsolePlansState, (state) => state.loading);
export const selectPlansError = createSelector(selectConsolePlansState, (state) => state.error);
export const selectSelectedPlanId = createSelector(selectConsolePlansState, (state) => state.selectedId);
export const selectSelectedPlan = createSelector(selectConsolePlansState, (state) => state.selected);
export const selectSelectedPlanLoading = createSelector(selectConsolePlansState, (state) => state.selectedLoading);
export const selectSelectedPlanError = createSelector(selectConsolePlansState, (state) => state.selectedError);
export const selectPlanActing = createSelector(selectConsolePlansState, (state) => state.acting);
export const selectPlanActionError = createSelector(selectConsolePlansState, (state) => state.actionError);
export const selectPlansLive = createSelector(selectConsolePlansState, (state) => state.live);
/** Projects the listed plans touch (for the project filter). */
export const selectPlanProjects = createSelector(selectPlans, (plans) =>
  [...new Set(plans.flatMap((p) => p.changes.flatMap((c) => (c.project ? [c.project] : []))))].sort(),
);
