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

export const selectAdminFileManagerEntriesForPath = (path: string) =>
  createSelector(selectAdminFileManagerState, (state) => {
    const cacheKey = buildAdminFileManagerCacheKey(state.view, state.viewTenantId, path);

    return state.directoriesByPath[cacheKey] ?? [];
  });

export const selectAdminFileManagerRootEntries = selectAdminFileManagerEntriesForPath('');
