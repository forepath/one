import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { ProjectTimeEntriesState } from './project-time-entries.reducer';

export const selectProjectTimeEntriesState = createFeatureSelector<ProjectTimeEntriesState>('projectTimeEntries');

export const selectProjectTimeEntries = createSelector(selectProjectTimeEntriesState, (s) => s.entries);
export const selectProjectTimeEntriesLoading = createSelector(selectProjectTimeEntriesState, (s) => s.loading);
export const selectProjectTimeEntriesSaving = createSelector(selectProjectTimeEntriesState, (s) => s.saving);
export const selectProjectTimeEntriesError = createSelector(selectProjectTimeEntriesState, (s) => s.error);

export const selectUnbilledProjectTimeEntries = createSelector(selectProjectTimeEntries, (entries) =>
  entries.filter((e) => !e.invoiceId),
);
