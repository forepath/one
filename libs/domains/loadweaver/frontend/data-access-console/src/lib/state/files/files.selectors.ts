import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { ConsoleFilesState } from './files.reducer';

export const selectConsoleFilesState = createFeatureSelector<ConsoleFilesState>('consoleFiles');

export const selectFilesTarget = createSelector(selectConsoleFilesState, (state) => state.target);
export const selectFilesPath = createSelector(selectConsoleFilesState, (state) => state.path);
export const selectFilesEntries = createSelector(selectConsoleFilesState, (state) => state.entries);
export const selectFilesLoading = createSelector(selectConsoleFilesState, (state) => state.loading);
export const selectFilesError = createSelector(selectConsoleFilesState, (state) => state.error);
export const selectFilesBusy = createSelector(selectConsoleFilesState, (state) => state.busy);
export const selectFilesOperationError = createSelector(selectConsoleFilesState, (state) => state.operationError);
export const selectFilesWarning = createSelector(selectConsoleFilesState, (state) => state.warning);
