import { createReducer, on } from '@ngrx/store';

import {
  cancelRun,
  cancelRunFailure,
  cancelRunSuccess,
  createDeploymentConfiguration,
  createDeploymentConfigurationFailure,
  createDeploymentConfigurationSuccess,
  deleteDeploymentConfiguration,
  deleteDeploymentConfigurationFailure,
  deleteDeploymentConfigurationSuccess,
  loadBranches,
  loadBranchesFailure,
  loadBranchesSuccess,
  loadDeploymentConfiguration,
  loadDeploymentConfigurationFailure,
  loadDeploymentConfigurationSuccess,
  loadJobLogs,
  loadJobLogsFailure,
  loadJobLogsSuccess,
  loadRepositories,
  loadRepositoriesFailure,
  loadRepositoriesSuccess,
  loadRunJobs,
  loadRunJobsFailure,
  loadRunJobsSuccess,
  loadRunLogs,
  loadRunLogsFailure,
  loadRunLogsSuccess,
  loadRunStatus,
  loadRunStatusFailure,
  loadRunStatusSuccess,
  loadRuns,
  loadRunsFailure,
  loadRunsSuccess,
  loadWorkflows,
  loadWorkflowsFailure,
  loadWorkflowsSuccess,
  triggerWorkflow,
  triggerWorkflowFailure,
  triggerWorkflowSuccess,
  updateDeploymentConfiguration,
  updateDeploymentConfigurationFailure,
  updateDeploymentConfigurationSuccess,
} from './deployments.actions';
import type { Branch, DeploymentConfiguration, DeploymentRun, Job, Repository, Workflow } from './deployments.types';

export interface DeploymentsState {
  configuration: DeploymentConfiguration | null;
  repositories: Repository[];
  branches: Branch[];
  workflows: Workflow[];
  runs: DeploymentRun[];
  jobs: Job[];
  runLogs: string | null;
  jobLogs: string | null;
  loadingConfiguration: boolean;
  loadingRepositories: boolean;
  loadingBranches: boolean;
  loadingWorkflows: boolean;
  loadingRuns: boolean;
  loadingRunStatus: boolean;
  loadingRunLogs: boolean;
  loadingRunJobs: boolean;
  loadingJobLogs: boolean;
  creatingConfiguration: boolean;
  updatingConfiguration: boolean;
  deletingConfiguration: boolean;
  triggeringWorkflow: boolean;
  cancelingRun: boolean;
  error: string | null;
}

export const initialDeploymentsState: DeploymentsState = {
  configuration: null,
  repositories: [],
  branches: [],
  workflows: [],
  runs: [],
  jobs: [],
  runLogs: null,
  jobLogs: null,
  loadingConfiguration: false,
  loadingRepositories: false,
  loadingBranches: false,
  loadingWorkflows: false,
  loadingRuns: false,
  loadingRunStatus: false,
  loadingRunLogs: false,
  loadingRunJobs: false,
  loadingJobLogs: false,
  creatingConfiguration: false,
  updatingConfiguration: false,
  deletingConfiguration: false,
  triggeringWorkflow: false,
  cancelingRun: false,
  error: null,
};

export const deploymentsReducer = createReducer(
  initialDeploymentsState,

  // Load Configuration
  on(loadDeploymentConfiguration, (state) => ({
    ...state,
    loadingConfiguration: true,
    error: null,
  })),
  on(loadDeploymentConfigurationSuccess, (state, { configuration }) => ({
    ...state,
    configuration,
    loadingConfiguration: false,
    error: null,
  })),
  on(loadDeploymentConfigurationFailure, (state, { error }) => ({
    ...state,
    loadingConfiguration: false,
    // Clear configuration on failure (e.g., 404 means no configuration exists)
    // This ensures the UI shows the "create configuration" form
    configuration: null,
    error,
  })),

  // Create Configuration
  on(createDeploymentConfiguration, (state) => ({
    ...state,
    creatingConfiguration: true,
    error: null,
  })),
  on(createDeploymentConfigurationSuccess, (state, { configuration }) => ({
    ...state,
    configuration,
    creatingConfiguration: false,
    error: null,
  })),
  on(createDeploymentConfigurationFailure, (state, { error }) => ({
    ...state,
    creatingConfiguration: false,
    error,
  })),

  // Update Configuration
  on(updateDeploymentConfiguration, (state) => ({
    ...state,
    updatingConfiguration: true,
    error: null,
  })),
  on(updateDeploymentConfigurationSuccess, (state, { configuration }) => ({
    ...state,
    configuration,
    updatingConfiguration: false,
    error: null,
  })),
  on(updateDeploymentConfigurationFailure, (state, { error }) => ({
    ...state,
    updatingConfiguration: false,
    error,
  })),

  // Delete Configuration
  on(deleteDeploymentConfiguration, (state) => ({
    ...state,
    deletingConfiguration: true,
    error: null,
  })),
  on(deleteDeploymentConfigurationSuccess, (state) => ({
    ...state,
    configuration: null,
    deletingConfiguration: false,
    error: null,
  })),
  on(deleteDeploymentConfigurationFailure, (state, { error }) => ({
    ...state,
    deletingConfiguration: false,
    error,
  })),

  // Load Repositories
  on(loadRepositories, (state) => ({
    ...state,
    loadingRepositories: true,
    error: null,
  })),
  on(loadRepositoriesSuccess, (state, { repositories }) => ({
    ...state,
    repositories,
    loadingRepositories: false,
    error: null,
  })),
  on(loadRepositoriesFailure, (state, { error }) => ({
    ...state,
    loadingRepositories: false,
    error,
  })),

  // Load Branches
  on(loadBranches, (state) => ({
    ...state,
    loadingBranches: true,
    error: null,
  })),
  on(loadBranchesSuccess, (state, { branches }) => ({
    ...state,
    branches,
    loadingBranches: false,
    error: null,
  })),
  on(loadBranchesFailure, (state, { error }) => ({
    ...state,
    loadingBranches: false,
    error,
  })),

  // Load Workflows
  on(loadWorkflows, (state) => ({
    ...state,
    loadingWorkflows: true,
    error: null,
  })),
  on(loadWorkflowsSuccess, (state, { workflows }) => ({
    ...state,
    workflows,
    loadingWorkflows: false,
    error: null,
  })),
  on(loadWorkflowsFailure, (state, { error }) => ({
    ...state,
    loadingWorkflows: false,
    error,
  })),

  // Load Runs
  on(loadRuns, (state) => ({
    ...state,
    loadingRuns: true,
    error: null,
  })),
  on(loadRunsSuccess, (state, { runs }) => ({
    ...state,
    runs,
    loadingRuns: false,
    error: null,
  })),
  on(loadRunsFailure, (state, { error }) => ({
    ...state,
    loadingRuns: false,
    error,
  })),

  // Trigger Workflow
  on(triggerWorkflow, (state) => ({
    ...state,
    triggeringWorkflow: true,
    error: null,
  })),
  on(triggerWorkflowSuccess, (state, { run }) => ({
    ...state,
    runs: [run, ...state.runs],
    triggeringWorkflow: false,
    error: null,
  })),
  on(triggerWorkflowFailure, (state, { error }) => ({
    ...state,
    triggeringWorkflow: false,
    error,
  })),

  // Load Run Status
  on(loadRunStatus, (state) => ({
    ...state,
    loadingRunStatus: true,
    error: null,
  })),
  on(loadRunStatusSuccess, (state, { run }) => ({
    ...state,
    runs: state.runs.map((r) => (r.id === run.id ? run : r)),
    loadingRunStatus: false,
    error: null,
  })),
  on(loadRunStatusFailure, (state, { error }) => ({
    ...state,
    loadingRunStatus: false,
    error,
  })),

  // Load Run Logs
  on(loadRunLogs, (state) => ({
    ...state,
    loadingRunLogs: true,
    error: null,
  })),
  on(loadRunLogsSuccess, (state, { logs }) => ({
    ...state,
    runLogs: logs,
    loadingRunLogs: false,
    error: null,
  })),
  on(loadRunLogsFailure, (state, { error }) => ({
    ...state,
    loadingRunLogs: false,
    error,
  })),

  // Cancel Run
  on(cancelRun, (state) => ({
    ...state,
    cancelingRun: true,
    error: null,
  })),
  on(cancelRunSuccess, (state) => ({
    ...state,
    cancelingRun: false,
    error: null,
  })),
  on(cancelRunFailure, (state, { error }) => ({
    ...state,
    cancelingRun: false,
    error,
  })),

  // Load Run Jobs
  on(loadRunJobs, (state) => ({
    ...state,
    loadingRunJobs: true,
    error: null,
  })),
  on(loadRunJobsSuccess, (state, { jobs }) => ({
    ...state,
    jobs,
    loadingRunJobs: false,
    error: null,
  })),
  on(loadRunJobsFailure, (state, { error }) => ({
    ...state,
    loadingRunJobs: false,
    error,
  })),

  // Load Job Logs
  on(loadJobLogs, (state) => ({
    ...state,
    loadingJobLogs: true,
    error: null,
  })),
  on(loadJobLogsSuccess, (state, { logs }) => ({
    ...state,
    jobLogs: logs,
    loadingJobLogs: false,
    error: null,
  })),
  on(loadJobLogsFailure, (state, { error }) => ({
    ...state,
    loadingJobLogs: false,
    error,
  })),
);
