import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { ConsoleSlosState } from './slos.reducer';

export const selectConsoleSlosState = createFeatureSelector<ConsoleSlosState>('consoleSlos');

export const selectSlos = createSelector(selectConsoleSlosState, (state) => state.slos);
export const selectSlosProject = createSelector(selectConsoleSlosState, (state) => state.project);
export const selectSlosLoading = createSelector(selectConsoleSlosState, (state) => state.loading);
export const selectSlosError = createSelector(selectConsoleSlosState, (state) => state.error);
/** SLOs per service state (as the overview counts them). */
export const selectSloCounts = createSelector(selectSlos, (slos) => ({
  total: slos.length,
  ok: slos.filter((s) => s.state === 'ok').length,
  burning: slos.filter((s) => s.state === 'burning').length,
  exhausted: slos.filter((s) => s.state === 'exhausted').length,
  noData: slos.filter((s) => s.state === 'no-data').length,
}));
