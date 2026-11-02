import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { ConsoleDriftState } from './drift.reducer';

export const selectConsoleDriftState = createFeatureSelector<ConsoleDriftState>('consoleDrift');

export const selectDriftReport = createSelector(selectConsoleDriftState, (state) => state.report);
export const selectDriftLoading = createSelector(selectConsoleDriftState, (state) => state.loading);
export const selectDriftError = createSelector(selectConsoleDriftState, (state) => state.error);
export const selectDriftProposing = createSelector(selectConsoleDriftState, (state) => state.proposing);
export const selectDriftProposeError = createSelector(selectConsoleDriftState, (state) => state.proposeError);
export const selectDriftCount = createSelector(
  selectDriftReport,
  (report) => (report?.containers.length ?? 0) + (report?.inconsistent.length ?? 0),
);
