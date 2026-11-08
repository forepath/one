import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { DeploymentConnectionsState } from './deployment-connections.reducer';

export const selectDeploymentConnectionsState =
  createFeatureSelector<DeploymentConnectionsState>('deploymentConnections');

export const selectDeploymentConnections = createSelector(selectDeploymentConnectionsState, (s) => s.connections);

export const selectDeploymentConnectionsQuery = createSelector(selectDeploymentConnectionsState, (s) => s.query);

export const selectDeploymentConnectionsHasNext = createSelector(selectDeploymentConnectionsState, (s) => s.hasNext);

export const selectDeploymentConnectionsLoading = createSelector(selectDeploymentConnectionsState, (s) => s.loading);

export const selectDeploymentConnectionsSaving = createSelector(selectDeploymentConnectionsState, (s) => s.saving);

export const selectDeploymentConnectionsTestingIds = createSelector(
  selectDeploymentConnectionsState,
  (s) => s.testingIds,
);

export const selectDeploymentConnectionsLastTest = createSelector(selectDeploymentConnectionsState, (s) => s.lastTest);

export const selectDeploymentConnectionsError = createSelector(selectDeploymentConnectionsState, (s) => s.error);
