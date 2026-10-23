import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { ConsoleReportsState } from './reports.reducer';

export const selectConsoleReportsState = createFeatureSelector<ConsoleReportsState>('consoleReports');

/** Newest month first, the cluster before projects. */
export const selectReports = createSelector(selectConsoleReportsState, (state) =>
  [...state.reports].sort(
    (a, b) =>
      b.year - a.year ||
      b.month - a.month ||
      Number(b.scope === 'cluster') - Number(a.scope === 'cluster') ||
      a.scope.localeCompare(b.scope),
  ),
);
export const selectReportsLoading = createSelector(selectConsoleReportsState, (state) => state.loading);
export const selectReportsError = createSelector(selectConsoleReportsState, (state) => state.error);
export const selectReportRunning = createSelector(selectConsoleReportsState, (state) => state.running);
export const selectReportQueued = createSelector(selectConsoleReportsState, (state) => state.queued);
export const selectReportRunError = createSelector(selectConsoleReportsState, (state) => state.runError);
export const selectReportPath = createSelector(selectConsoleReportsState, (state) => state.path);
/** Folders first, then by name. */
export const selectReportEntries = createSelector(selectConsoleReportsState, (state) =>
  [...state.entries].sort(
    (a, b) => Number(b.type === 'folder') - Number(a.type === 'folder') || a.name.localeCompare(b.name),
  ),
);
export const selectReportEntriesLoading = createSelector(selectConsoleReportsState, (state) => state.entriesLoading);
export const selectReportEntriesError = createSelector(selectConsoleReportsState, (state) => state.entriesError);
