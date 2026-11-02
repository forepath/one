import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { ConsoleLogsState } from './logs.reducer';

export const selectConsoleLogsState = createFeatureSelector<ConsoleLogsState>('consoleLogs');

export const selectLogsFilter = createSelector(selectConsoleLogsState, (state) => state.filter);
export const selectLogsLimit = createSelector(selectConsoleLogsState, (state) => state.limit);
export const selectLogLines = createSelector(selectConsoleLogsState, (state) => state.lines);
export const selectLogsPage = createSelector(selectConsoleLogsState, (state) => state.page);
export const selectLogsHasNext = createSelector(selectConsoleLogsState, (state) => state.nextCursor !== null);
export const selectLogsHasPrevious = createSelector(selectConsoleLogsState, (state) => state.page > 0);
export const selectLogsLoading = createSelector(selectConsoleLogsState, (state) => state.loading);
export const selectLogsError = createSelector(selectConsoleLogsState, (state) => state.error);
export const selectLogsTailing = createSelector(selectConsoleLogsState, (state) => state.tailing);
export const selectLogsTailConnected = createSelector(selectConsoleLogsState, (state) => state.tailConnected);
export const selectLogsTailError = createSelector(selectConsoleLogsState, (state) => state.tailError);
export const selectLogsTail = createSelector(selectConsoleLogsState, (state) => state.tail);
