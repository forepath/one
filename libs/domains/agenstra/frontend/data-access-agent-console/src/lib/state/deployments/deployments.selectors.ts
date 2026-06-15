import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { DeploymentsState } from './deployments.reducer';

export const selectDeploymentsState = createFeatureSelector<DeploymentsState>('deployments');

export const selectDeploymentConfiguration = createSelector(selectDeploymentsState, (state) => state.configuration);

export const selectRepositories = createSelector(selectDeploymentsState, (state) => state.repositories);

export const selectBranches = createSelector(selectDeploymentsState, (state) => state.branches);

export const selectWorkflows = createSelector(selectDeploymentsState, (state) => state.workflows);

export const selectRuns = createSelector(selectDeploymentsState, (state) => state.runs);

export const selectJobs = createSelector(selectDeploymentsState, (state) => state.jobs);

export const selectRunLogs = createSelector(selectDeploymentsState, (state) => state.runLogs);

export const selectJobLogs = createSelector(selectDeploymentsState, (state) => state.jobLogs);

export const selectLoadingConfiguration = createSelector(selectDeploymentsState, (state) => state.loadingConfiguration);

export const selectLoadingRepositories = createSelector(selectDeploymentsState, (state) => state.loadingRepositories);

export const selectLoadingDeploymentBranches = createSelector(selectDeploymentsState, (state) => state.loadingBranches);

export const selectLoadingWorkflows = createSelector(selectDeploymentsState, (state) => state.loadingWorkflows);

export const selectLoadingRuns = createSelector(selectDeploymentsState, (state) => state.loadingRuns);

export const selectLoadingRunStatus = createSelector(selectDeploymentsState, (state) => state.loadingRunStatus);

export const selectLoadingRunLogs = createSelector(selectDeploymentsState, (state) => state.loadingRunLogs);

export const selectLoadingRunJobs = createSelector(selectDeploymentsState, (state) => state.loadingRunJobs);

export const selectLoadingJobLogs = createSelector(selectDeploymentsState, (state) => state.loadingJobLogs);

export const selectCreatingConfiguration = createSelector(
  selectDeploymentsState,
  (state) => state.creatingConfiguration,
);

export const selectUpdatingConfiguration = createSelector(
  selectDeploymentsState,
  (state) => state.updatingConfiguration,
);

export const selectDeletingConfiguration = createSelector(
  selectDeploymentsState,
  (state) => state.deletingConfiguration,
);

export const selectTriggeringWorkflow = createSelector(selectDeploymentsState, (state) => state.triggeringWorkflow);

export const selectCancelingRun = createSelector(selectDeploymentsState, (state) => state.cancelingRun);

export const selectDeploymentsError = createSelector(selectDeploymentsState, (state) => state.error);

/**
 * Select a specific run by ID
 */
export const selectRunById = (runId: string) =>
  createSelector(selectRuns, (runs) => runs.find((run) => run.id === runId));

/**
 * Select runs filtered by status
 */
export const selectRunsByStatus = (status: string) =>
  createSelector(selectRuns, (runs) => runs.filter((run) => run.status === status));

/**
 * Select runs filtered by conclusion
 */
export const selectRunsByConclusion = (conclusion: string) =>
  createSelector(selectRuns, (runs) => runs.filter((run) => run.conclusion === conclusion));

/**
 * Select a specific job by ID
 */
export const selectJobById = (jobId: string) =>
  createSelector(selectJobs, (jobs) => jobs.find((job) => job.id === jobId));

/**
 * Select jobs filtered by status
 */
export const selectJobsByStatus = (status: string) =>
  createSelector(selectJobs, (jobs) => jobs.filter((job) => job.status === status));
