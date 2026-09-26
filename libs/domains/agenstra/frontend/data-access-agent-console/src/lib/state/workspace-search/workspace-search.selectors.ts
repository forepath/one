import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { WorkspaceSearchState } from './workspace-search.reducer';

export const selectWorkspaceSearchState = createFeatureSelector<WorkspaceSearchState>('workspaceSearch');

export const selectWorkspaceSearchQuery = createSelector(selectWorkspaceSearchState, (state) => state.query);
export const selectWorkspaceSearchMode = createSelector(selectWorkspaceSearchState, (state) => state.mode);
export const selectWorkspaceIncludePaths = createSelector(selectWorkspaceSearchState, (state) => state.includePaths);
export const selectWorkspaceExcludePaths = createSelector(selectWorkspaceSearchState, (state) => state.excludePaths);
export const selectWorkspaceIndexStatus = createSelector(selectWorkspaceSearchState, (state) => state.indexStatus);
export const selectWorkspaceSearchHits = createSelector(selectWorkspaceSearchState, (state) => state.hits);
export const selectWorkspaceSearchLoading = createSelector(selectWorkspaceSearchState, (state) => state.loading);
export const selectWorkspaceSearchError = createSelector(selectWorkspaceSearchState, (state) => state.error);
export const selectWorkspaceSearchDocCount = createSelector(selectWorkspaceSearchState, (state) => state.docCount);
