import { createFeatureSelector, createSelector } from '@ngrx/store';

import { CloudInitConfigsState } from './cloud-init-configs.reducer';

export const selectCloudInitConfigsState = createFeatureSelector<CloudInitConfigsState>('cloudInitConfigs');

export const selectCloudInitConfigsEntities = createSelector(selectCloudInitConfigsState, (state) => state.entities);

export const selectActiveCloudInitConfigs = createSelector(selectCloudInitConfigsEntities, (entities) =>
  entities.filter((c) => c.isActive),
);

export const selectSelectedCloudInitConfig = createSelector(
  selectCloudInitConfigsState,
  (state) => state.selectedCloudInitConfig,
);

export const selectCloudInitConfigsLoading = createSelector(selectCloudInitConfigsState, (state) => state.loading);

export const selectCloudInitConfigLoading = createSelector(
  selectCloudInitConfigsState,
  (state) => state.loadingCloudInitConfig,
);

export const selectCloudInitConfigsCreating = createSelector(selectCloudInitConfigsState, (state) => state.creating);

export const selectCloudInitConfigsUpdating = createSelector(selectCloudInitConfigsState, (state) => state.updating);

export const selectCloudInitConfigsDeleting = createSelector(selectCloudInitConfigsState, (state) => state.deleting);

export const selectCloudInitConfigsError = createSelector(selectCloudInitConfigsState, (state) => state.error);

export const selectCloudInitConfigsLoadingAny = createSelector(
  selectCloudInitConfigsState,
  (state) => state.loading || state.loadingCloudInitConfig || state.creating || state.updating || state.deleting,
);

export const selectCloudInitConfigById = (id: string) =>
  createSelector(selectCloudInitConfigsEntities, (entities) => entities.find((c) => c.id === id));
