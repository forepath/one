import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { ConsoleOverviewState } from './overview.reducer';

export const selectConsoleOverviewState = createFeatureSelector<ConsoleOverviewState>('consoleOverview');

export const selectOverview = createSelector(selectConsoleOverviewState, (state) => state.overview);
export const selectOverviewLoading = createSelector(selectConsoleOverviewState, (state) => state.loading);
export const selectOverviewError = createSelector(selectConsoleOverviewState, (state) => state.error);
export const selectOverviewProject = createSelector(selectConsoleOverviewState, (state) => state.project);
export const selectInbox = createSelector(selectOverview, (overview) => overview?.inbox ?? []);
export const selectCriticalInboxCount = createSelector(
  selectInbox,
  (inbox) => inbox.filter((item) => item.severity === 'critical').length,
);
