import { createFeatureSelector, createSelector } from '@ngrx/store';

import { buildAdminFileManagerCacheKey, type AdminFileManagerState } from './admin-file-manager.reducer';

export const selectAdminFileManagerState = createFeatureSelector<AdminFileManagerState>('adminFileManager');

export const selectAdminFileManagerView = createSelector(selectAdminFileManagerState, (state) => state.view);

export const selectAdminFileManagerViewTenantId = createSelector(
  selectAdminFileManagerState,
  (state) => state.viewTenantId,
);

export const selectAdminFileManagerError = createSelector(selectAdminFileManagerState, (state) => state.error);

export const selectAdminFileManagerDownloadLoading = createSelector(
  selectAdminFileManagerState,
  (state) => state.downloadLoading,
);

export const selectAdminFileManagerLoadingPath = createSelector(
  selectAdminFileManagerState,
  (state) => state.loadingPath,
);

export const selectAdminFileManagerExpandedPaths = createSelector(
  selectAdminFileManagerState,
  (state) => state.expandedPaths,
);

export const selectAdminFileManagerVerifyLoading = createSelector(
  selectAdminFileManagerState,
  (state) => state.verifyLoading,
);

export const selectAdminFileManagerVerifyResult = createSelector(
  selectAdminFileManagerState,
  (state) => state.verifyResult,
);

export const selectAdminFileManagerVerifyError = createSelector(
  selectAdminFileManagerState,
  (state) => state.verifyError,
);

export const selectAdminFileManagerDocumentIdLookupLoading = createSelector(
  selectAdminFileManagerState,
  (state) => state.documentIdLookupLoading,
);

export const selectAdminFileManagerDocumentIdLookupError = createSelector(
  selectAdminFileManagerState,
  (state) => state.documentIdLookupError,
);

export const selectAdminFileManagerDocumentIdLookupSuccess = createSelector(
  selectAdminFileManagerState,
  (state) => state.documentIdLookupSuccess,
);

export const selectAdminFileManagerEntriesForPath = (path: string) =>
  createSelector(selectAdminFileManagerState, (state) => {
    const cacheKey = buildAdminFileManagerCacheKey(state.view, state.viewTenantId, path);

    return state.directoriesByPath[cacheKey] ?? [];
  });

export const selectAdminFileManagerRootEntries = selectAdminFileManagerEntriesForPath('');
