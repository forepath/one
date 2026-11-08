import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { WorkspaceDeploymentsState } from './workspace-deployments.reducer';

export const selectWorkspaceDeploymentsState = createFeatureSelector<WorkspaceDeploymentsState>('workspaceDeployments');

export const selectWorkspaceDeploymentsClientId = createSelector(selectWorkspaceDeploymentsState, (s) => s.clientId);

export const selectDeploymentWorkflows = createSelector(selectWorkspaceDeploymentsState, (s) => s.workflows);

export const selectDeploymentWorkflowsQuery = createSelector(selectWorkspaceDeploymentsState, (s) => s.workflowsQuery);

export const selectDeploymentWorkflowsHasNext = createSelector(
  selectWorkspaceDeploymentsState,
  (s) => s.workflowsHasNext,
);

export const selectDeploymentWorkflowsLoading = createSelector(
  selectWorkspaceDeploymentsState,
  (s) => s.workflowsLoading,
);

export const selectSelectedDeploymentWorkflow = createSelector(
  selectWorkspaceDeploymentsState,
  (s) => s.selectedWorkflow,
);

export const selectSelectedDeploymentWorkflowLoading = createSelector(
  selectWorkspaceDeploymentsState,
  (s) => s.selectedWorkflowLoading,
);

export const selectDeploymentRuns = createSelector(selectWorkspaceDeploymentsState, (s) => s.runs);

export const selectDeploymentRunsQuery = createSelector(selectWorkspaceDeploymentsState, (s) => s.runsQuery);

export const selectDeploymentRunsTotal = createSelector(selectWorkspaceDeploymentsState, (s) => s.runsTotal);

export const selectDeploymentRunsLoading = createSelector(selectWorkspaceDeploymentsState, (s) => s.runsLoading);

export const selectSelectedDeploymentRun = createSelector(selectWorkspaceDeploymentsState, (s) => s.selectedRun);

export const selectSelectedDeploymentRunLoading = createSelector(
  selectWorkspaceDeploymentsState,
  (s) => s.selectedRunLoading,
);

export const selectDeploymentRunLogs = createSelector(selectWorkspaceDeploymentsState, (s) => s.logs);

export const selectDeploymentRunLogsTarget = createSelector(selectWorkspaceDeploymentsState, (s) => s.logsTarget);

export const selectDeploymentRunLogsLoading = createSelector(selectWorkspaceDeploymentsState, (s) => s.logsLoading);

export const selectDeploymentRunLogsError = createSelector(selectWorkspaceDeploymentsState, (s) => s.logsError);

export const selectDeploymentConnectionOptions = createSelector(
  selectWorkspaceDeploymentsState,
  (s) => s.connectionOptions,
);

export const selectDeploymentConnectionOptionsLoading = createSelector(
  selectWorkspaceDeploymentsState,
  (s) => s.connectionOptionsLoading,
);

export const selectWorkspaceDeploymentsSaving = createSelector(selectWorkspaceDeploymentsState, (s) => s.saving);

export const selectWorkspaceDeploymentsTriggering = createSelector(
  selectWorkspaceDeploymentsState,
  (s) => s.triggering,
);

export const selectLastTriggeredDeploymentRun = createSelector(
  selectWorkspaceDeploymentsState,
  (s) => s.lastTriggeredRun,
);

export const selectSyncingDeploymentWorkflowIds = createSelector(
  selectWorkspaceDeploymentsState,
  (s) => s.syncingWorkflowIds,
);

export const selectApprovingDeploymentWorkflowIds = createSelector(
  selectWorkspaceDeploymentsState,
  (s) => s.approvingWorkflowIds,
);

export const selectCancellingDeploymentRunIds = createSelector(
  selectWorkspaceDeploymentsState,
  (s) => s.cancellingRunIds,
);

export const selectWorkspaceDeploymentsError = createSelector(selectWorkspaceDeploymentsState, (s) => s.error);
