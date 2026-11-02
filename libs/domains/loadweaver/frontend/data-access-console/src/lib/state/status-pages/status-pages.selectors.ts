import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { ConsoleStatusPagesState } from './status-pages.reducer';

export const selectConsoleStatusPagesState = createFeatureSelector<ConsoleStatusPagesState>('consoleStatusPages');

export const selectStatusPages = createSelector(selectConsoleStatusPagesState, (state) => state.pages);
export const selectStatusPagesLoading = createSelector(selectConsoleStatusPagesState, (state) => state.pagesLoading);
export const selectStatusPagesError = createSelector(selectConsoleStatusPagesState, (state) => state.pagesError);
export const selectIncidentsProject = createSelector(selectConsoleStatusPagesState, (state) => state.project);
export const selectIncidents = createSelector(selectConsoleStatusPagesState, (state) => state.incidents);
export const selectIncidentsLoading = createSelector(selectConsoleStatusPagesState, (state) => state.incidentsLoading);
export const selectIncidentsError = createSelector(selectConsoleStatusPagesState, (state) => state.incidentsError);
export const selectOpenIncidentCount = createSelector(
  selectIncidents,
  (incidents) => incidents.filter((i) => i.status !== 'resolved').length,
);
export const selectIncidentCreating = createSelector(selectConsoleStatusPagesState, (state) => state.creating);
export const selectIncidentUpdating = createSelector(selectConsoleStatusPagesState, (state) => state.updating);
export const selectIncidentActionError = createSelector(selectConsoleStatusPagesState, (state) => state.actionError);
