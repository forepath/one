import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { ProjectEstimatorState } from './project-estimator.reducer';

export const selectProjectEstimatorState = createFeatureSelector<ProjectEstimatorState>('projectEstimator');

export const selectDeviceCapability = createSelector(selectProjectEstimatorState, (state) => state.deviceCapability);

export const selectDeviceSupported = createSelector(selectDeviceCapability, (status) => status === 'supported');

export const selectUnsupportedReason = createSelector(selectProjectEstimatorState, (state) => state.unsupportedReason);

export const selectModelStatus = createSelector(selectProjectEstimatorState, (state) => state.modelStatus);

export const selectModelLoadProgress = createSelector(selectProjectEstimatorState, (state) => state.modelLoadProgress);

export const selectModelLoadText = createSelector(selectProjectEstimatorState, (state) => state.modelLoadText);

export const selectDeviceMaxMemoryProfileId = createSelector(
  selectProjectEstimatorState,
  (state) => state.deviceMaxMemoryProfileId,
);

export const selectActiveMemoryProfileId = createSelector(
  selectProjectEstimatorState,
  (state) => state.activeMemoryProfileId,
);

export const selectIsModelReady = createSelector(selectModelStatus, (status) => status === 'ready');

export const selectMessages = createSelector(selectProjectEstimatorState, (state) => state.messages);

export const selectCurrentEstimate = createSelector(selectProjectEstimatorState, (state) => state.currentEstimate);

export const selectIsEstimating = createSelector(selectProjectEstimatorState, (state) => state.estimating);

export const selectEstimateError = createSelector(selectProjectEstimatorState, (state) => state.error);

export const selectHasEstimate = createSelector(selectCurrentEstimate, (estimate) => estimate !== null);

export const selectCanSubmit = createSelector(
  selectDeviceSupported,
  selectModelStatus,
  selectIsEstimating,
  selectHasEstimate,
  (deviceSupported, modelStatus, estimating, hasEstimate) =>
    deviceSupported && modelStatus === 'ready' && !estimating && !hasEstimate,
);

export const selectGpuAccessStatus = createSelector(selectProjectEstimatorState, (state) => state.gpuAccessStatus);

export const selectIsAwaitingGpuPermission = createSelector(selectGpuAccessStatus, (status) => status === 'pending');

export const selectIsRequestingGpuAccess = createSelector(selectGpuAccessStatus, (status) => status === 'requesting');

export const selectIsCheckingDevice = createSelector(selectDeviceCapability, (status) => status === 'checking');

export const selectIsModelLoading = createSelector(selectModelStatus, (status) => status === 'loading');
