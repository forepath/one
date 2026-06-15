import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { AtlassianContextImportState } from './context-import.reducer';

export const selectAtlassianContextImportState =
  createFeatureSelector<AtlassianContextImportState>('atlassianContextImport');

export const selectAtlassianConnections = createSelector(selectAtlassianContextImportState, (s) => s.connections);

export const selectExternalImportConfigs = createSelector(selectAtlassianContextImportState, (s) => s.configs);

export const selectAtlassianContextImportLoading = createSelector(selectAtlassianContextImportState, (s) => s.loading);

export const selectAtlassianContextImportError = createSelector(selectAtlassianContextImportState, (s) => s.error);

export const selectAtlassianContextImportSaving = createSelector(selectAtlassianContextImportState, (s) => s.saving);

export const selectAtlassianContextImportDeleting = createSelector(
  selectAtlassianContextImportState,
  (s) => s.deleting,
);

export const selectAtlassianContextImportRunningConfigId = createSelector(
  selectAtlassianContextImportState,
  (s) => s.runningConfigId,
);

export const selectAtlassianContextImportTestingConnectionId = createSelector(
  selectAtlassianContextImportState,
  (s) => s.testingConnectionId,
);

export const selectAtlassianContextImportClearingMarkersId = createSelector(
  selectAtlassianContextImportState,
  (s) => s.clearingMarkersId,
);

export const selectAtlassianLastConnectionTest = createSelector(
  selectAtlassianContextImportState,
  (s) => s.lastConnectionTest,
);
