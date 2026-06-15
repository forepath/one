import { createAction, props } from '@ngrx/store';

import type {
  Branch,
  CreateDeploymentConfigurationDto,
  DeploymentConfiguration,
  DeploymentRun,
  Job,
  Repository,
  TriggerWorkflowDto,
  UpdateDeploymentConfigurationDto,
  Workflow,
} from './deployments.types';

// Configuration Actions
export const loadDeploymentConfiguration = createAction(
  '[Deployments] Load Deployment Configuration',
  props<{ clientId: string; agentId: string }>(),
);

export const loadDeploymentConfigurationSuccess = createAction(
  '[Deployments] Load Deployment Configuration Success',
  props<{ configuration: DeploymentConfiguration | null }>(),
);

export const loadDeploymentConfigurationFailure = createAction(
  '[Deployments] Load Deployment Configuration Failure',
  props<{ error: string }>(),
);

export const createDeploymentConfiguration = createAction(
  '[Deployments] Create Deployment Configuration',
  props<{ clientId: string; agentId: string; dto: CreateDeploymentConfigurationDto }>(),
);

export const createDeploymentConfigurationSuccess = createAction(
  '[Deployments] Create Deployment Configuration Success',
  props<{ configuration: DeploymentConfiguration }>(),
);

export const createDeploymentConfigurationFailure = createAction(
  '[Deployments] Create Deployment Configuration Failure',
  props<{ error: string }>(),
);

export const updateDeploymentConfiguration = createAction(
  '[Deployments] Update Deployment Configuration',
  props<{ clientId: string; agentId: string; dto: UpdateDeploymentConfigurationDto }>(),
);

export const updateDeploymentConfigurationSuccess = createAction(
  '[Deployments] Update Deployment Configuration Success',
  props<{ configuration: DeploymentConfiguration }>(),
);

export const updateDeploymentConfigurationFailure = createAction(
  '[Deployments] Update Deployment Configuration Failure',
  props<{ error: string }>(),
);

export const deleteDeploymentConfiguration = createAction(
  '[Deployments] Delete Deployment Configuration',
  props<{ clientId: string; agentId: string }>(),
);

export const deleteDeploymentConfigurationSuccess = createAction(
  '[Deployments] Delete Deployment Configuration Success',
);

export const deleteDeploymentConfigurationFailure = createAction(
  '[Deployments] Delete Deployment Configuration Failure',
  props<{ error: string }>(),
);

// Repository Actions
export const loadRepositories = createAction(
  '[Deployments] Load Repositories',
  props<{ clientId: string; agentId: string }>(),
);

export const loadRepositoriesSuccess = createAction(
  '[Deployments] Load Repositories Success',
  props<{ repositories: Repository[] }>(),
);

export const loadRepositoriesFailure = createAction(
  '[Deployments] Load Repositories Failure',
  props<{ error: string }>(),
);

// Branch Actions
export const loadBranches = createAction(
  '[Deployments] Load Branches',
  props<{ clientId: string; agentId: string; repositoryId: string }>(),
);

export const loadBranchesSuccess = createAction('[Deployments] Load Branches Success', props<{ branches: Branch[] }>());

export const loadBranchesFailure = createAction('[Deployments] Load Branches Failure', props<{ error: string }>());

// Workflow Actions
export const loadWorkflows = createAction(
  '[Deployments] Load Workflows',
  props<{ clientId: string; agentId: string; repositoryId: string; branch?: string }>(),
);

export const loadWorkflowsSuccess = createAction(
  '[Deployments] Load Workflows Success',
  props<{ workflows: Workflow[] }>(),
);

export const loadWorkflowsFailure = createAction('[Deployments] Load Workflows Failure', props<{ error: string }>());

// Run Actions
export const loadRuns = createAction(
  '[Deployments] Load Runs',
  props<{ clientId: string; agentId: string; limit?: number; offset?: number }>(),
);

export const loadRunsSuccess = createAction('[Deployments] Load Runs Success', props<{ runs: DeploymentRun[] }>());

export const loadRunsFailure = createAction('[Deployments] Load Runs Failure', props<{ error: string }>());

export const triggerWorkflow = createAction(
  '[Deployments] Trigger Workflow',
  props<{ clientId: string; agentId: string; dto: TriggerWorkflowDto }>(),
);

export const triggerWorkflowSuccess = createAction(
  '[Deployments] Trigger Workflow Success',
  props<{ run: DeploymentRun }>(),
);

export const triggerWorkflowFailure = createAction(
  '[Deployments] Trigger Workflow Failure',
  props<{ error: string }>(),
);

export const loadRunStatus = createAction(
  '[Deployments] Load Run Status',
  props<{ clientId: string; agentId: string; runId: string }>(),
);

export const loadRunStatusSuccess = createAction(
  '[Deployments] Load Run Status Success',
  props<{ run: DeploymentRun }>(),
);

export const loadRunStatusFailure = createAction('[Deployments] Load Run Status Failure', props<{ error: string }>());

export const loadRunLogs = createAction(
  '[Deployments] Load Run Logs',
  props<{ clientId: string; agentId: string; runId: string }>(),
);

export const loadRunLogsSuccess = createAction('[Deployments] Load Run Logs Success', props<{ logs: string }>());

export const loadRunLogsFailure = createAction('[Deployments] Load Run Logs Failure', props<{ error: string }>());

export const cancelRun = createAction(
  '[Deployments] Cancel Run',
  props<{ clientId: string; agentId: string; runId: string }>(),
);

export const cancelRunSuccess = createAction('[Deployments] Cancel Run Success');

export const cancelRunFailure = createAction('[Deployments] Cancel Run Failure', props<{ error: string }>());

// Job Actions
export const loadRunJobs = createAction(
  '[Deployments] Load Run Jobs',
  props<{ clientId: string; agentId: string; runId: string }>(),
);

export const loadRunJobsSuccess = createAction('[Deployments] Load Run Jobs Success', props<{ jobs: Job[] }>());

export const loadRunJobsFailure = createAction('[Deployments] Load Run Jobs Failure', props<{ error: string }>());

export const loadJobLogs = createAction(
  '[Deployments] Load Job Logs',
  props<{ clientId: string; agentId: string; runId: string; jobId: string }>(),
);

export const loadJobLogsSuccess = createAction('[Deployments] Load Job Logs Success', props<{ logs: string }>());

export const loadJobLogsFailure = createAction('[Deployments] Load Job Logs Failure', props<{ error: string }>());
