import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { ConsoleUsageState } from './usage.reducer';

export const selectConsoleUsageState = createFeatureSelector<ConsoleUsageState>('consoleUsage');

export const selectUsageQuery = createSelector(selectConsoleUsageState, (state) => state.query);
export const selectUsageReport = createSelector(selectConsoleUsageState, (state) => state.report);
export const selectUsageLoading = createSelector(selectConsoleUsageState, (state) => state.loading);
export const selectUsageError = createSelector(selectConsoleUsageState, (state) => state.error);
