import type {
  DeploymentConnectionOption,
  DeploymentRunDetail,
  DeploymentRunLogs,
  DeploymentRunSummary,
  DeploymentWorkflowRemovedPayload,
  DeploymentWorkflowSummary,
} from '@forepath/agenstra/shared/util-opencode-config';
import { createAction, props } from '@ngrx/store';

import type {
  CreateDeploymentWorkflowDto,
  DeploymentRunsQuery,
  DeploymentWorkflowsQuery,
  TriggerDeploymentWorkflowDto,
  UpdateDeploymentWorkflowDto,
} from './workspace-deployments.types';

// --- workflows -----------------------------------------------------------------------------------------------

export const loadDeploymentWorkflows = createAction(
  '[Workspace Deployments] Load Workflows',
  props<{ clientId: string; query: DeploymentWorkflowsQuery }>(),
);

export const loadDeploymentWorkflowsSuccess = createAction(
  '[Workspace Deployments] Load Workflows Success',
  props<{ clientId: string; workflows: DeploymentWorkflowSummary[]; hasNext: boolean }>(),
);

export const loadDeploymentWorkflowsFailure = createAction(
  '[Workspace Deployments] Load Workflows Failure',
  props<{ error: string }>(),
);

/** Opened workflow (kept separately: it may not be on the listed page). */
export const loadDeploymentWorkflow = createAction(
  '[Workspace Deployments] Load Workflow',
  props<{ clientId: string; workflowId: string }>(),
);

export const loadDeploymentWorkflowSuccess = createAction(
  '[Workspace Deployments] Load Workflow Success',
  props<{ workflow: DeploymentWorkflowSummary }>(),
);

export const loadDeploymentWorkflowFailure = createAction(
  '[Workspace Deployments] Load Workflow Failure',
  props<{ workflowId: string; error: string }>(),
);

export const clearSelectedDeploymentWorkflow = createAction('[Workspace Deployments] Clear Selected Workflow');

export const createDeploymentWorkflow = createAction(
  '[Workspace Deployments] Create Workflow',
  props<{ clientId: string; dto: CreateDeploymentWorkflowDto }>(),
);

export const createDeploymentWorkflowSuccess = createAction(
  '[Workspace Deployments] Create Workflow Success',
  props<{ workflow: DeploymentWorkflowSummary }>(),
);

export const updateDeploymentWorkflow = createAction(
  '[Workspace Deployments] Update Workflow',
  props<{ clientId: string; workflowId: string; dto: UpdateDeploymentWorkflowDto }>(),
);

export const updateDeploymentWorkflowSuccess = createAction(
  '[Workspace Deployments] Update Workflow Success',
  props<{ workflow: DeploymentWorkflowSummary }>(),
);

export const deleteDeploymentWorkflow = createAction(
  '[Workspace Deployments] Delete Workflow',
  props<{ clientId: string; workflowId: string }>(),
);

export const deleteDeploymentWorkflowSuccess = createAction(
  '[Workspace Deployments] Delete Workflow Success',
  props<{ workflowId: string }>(),
);

export const saveDeploymentWorkflowFailure = createAction(
  '[Workspace Deployments] Save Workflow Failure',
  props<{ error: string }>(),
);

/** Approve a workflow an environment proposed / changed, bound to the reviewed version (`updatedAt`). */
export const approveDeploymentWorkflow = createAction(
  '[Workspace Deployments] Approve Workflow',
  props<{ clientId: string; workflowId: string; updatedAt: string }>(),
);

export const approveDeploymentWorkflowSuccess = createAction(
  '[Workspace Deployments] Approve Workflow Success',
  props<{ workflow: DeploymentWorkflowSummary }>(),
);

/** `conflict`: the workflow changed since it was reviewed (409); the page reloads it. */
export const approveDeploymentWorkflowFailure = createAction(
  '[Workspace Deployments] Approve Workflow Failure',
  props<{ clientId: string; workflowId: string; error: string; conflict: boolean }>(),
);

export const triggerDeploymentWorkflow = createAction(
  '[Workspace Deployments] Trigger Workflow',
  props<{ clientId: string; workflowId: string; dto: TriggerDeploymentWorkflowDto }>(),
);

export const triggerDeploymentWorkflowSuccess = createAction(
  '[Workspace Deployments] Trigger Workflow Success',
  props<{ run: DeploymentRunSummary }>(),
);

export const triggerDeploymentWorkflowFailure = createAction(
  '[Workspace Deployments] Trigger Workflow Failure',
  props<{ error: string }>(),
);

export const syncDeploymentWorkflow = createAction(
  '[Workspace Deployments] Sync Workflow',
  props<{ clientId: string; workflowId: string }>(),
);

export const syncDeploymentWorkflowSuccess = createAction(
  '[Workspace Deployments] Sync Workflow Success',
  props<{ workflowId: string; synced: number }>(),
);

export const syncDeploymentWorkflowFailure = createAction(
  '[Workspace Deployments] Sync Workflow Failure',
  props<{ workflowId: string; error: string }>(),
);

// --- runs ----------------------------------------------------------------------------------------------------

export const loadDeploymentRuns = createAction(
  '[Workspace Deployments] Load Runs',
  props<{ clientId: string; query: DeploymentRunsQuery }>(),
);

export const loadDeploymentRunsSuccess = createAction(
  '[Workspace Deployments] Load Runs Success',
  props<{ clientId: string; runs: DeploymentRunSummary[]; total: number }>(),
);

export const loadDeploymentRunsFailure = createAction(
  '[Workspace Deployments] Load Runs Failure',
  props<{ error: string }>(),
);

/** Opened run with its jobs; `refresh` keeps the shown detail while reloading (live progress). */
export const loadDeploymentRun = createAction(
  '[Workspace Deployments] Load Run',
  props<{ clientId: string; runId: string; refresh?: boolean }>(),
);

export const loadDeploymentRunSuccess = createAction(
  '[Workspace Deployments] Load Run Success',
  props<{ detail: DeploymentRunDetail }>(),
);

export const loadDeploymentRunFailure = createAction(
  '[Workspace Deployments] Load Run Failure',
  props<{ runId: string; error: string }>(),
);

export const clearSelectedDeploymentRun = createAction('[Workspace Deployments] Clear Selected Run');

/** Logs of the whole run (`jobId: null`) or one job. */
export const loadDeploymentRunLogs = createAction(
  '[Workspace Deployments] Load Run Logs',
  props<{ clientId: string; runId: string; jobId: string | null }>(),
);

export const loadDeploymentRunLogsSuccess = createAction(
  '[Workspace Deployments] Load Run Logs Success',
  props<{ runId: string; jobId: string | null; logs: DeploymentRunLogs }>(),
);

export const loadDeploymentRunLogsFailure = createAction(
  '[Workspace Deployments] Load Run Logs Failure',
  props<{ runId: string; jobId: string | null; error: string }>(),
);

export const clearDeploymentRunLogs = createAction('[Workspace Deployments] Clear Run Logs');

export const cancelDeploymentRun = createAction(
  '[Workspace Deployments] Cancel Run',
  props<{ clientId: string; runId: string }>(),
);

export const cancelDeploymentRunSuccess = createAction(
  '[Workspace Deployments] Cancel Run Success',
  props<{ run: DeploymentRunSummary }>(),
);

export const cancelDeploymentRunFailure = createAction(
  '[Workspace Deployments] Cancel Run Failure',
  props<{ runId: string; error: string }>(),
);

// --- connection options (workflow editor, workspace admins) ------------------------------------------------------

export const loadDeploymentConnectionOptions = createAction(
  '[Workspace Deployments] Load Connection Options',
  props<{ clientId: string }>(),
);

export const loadDeploymentConnectionOptionsSuccess = createAction(
  '[Workspace Deployments] Load Connection Options Success',
  props<{ clientId: string; connections: DeploymentConnectionOption[] }>(),
);

export const loadDeploymentConnectionOptionsFailure = createAction(
  '[Workspace Deployments] Load Connection Options Failure',
  props<{ error: string }>(),
);

// --- live (clients socket) -------------------------------------------------------------------------------------

/** `deploymentWorkflowUpsert`: workflow created / changed (also its last-run fields). */
export const deploymentWorkflowUpsertReceived = createAction(
  '[Workspace Deployments] Workflow Upsert Received',
  props<{ workflow: DeploymentWorkflowSummary }>(),
);

/** `deploymentWorkflowRemoved`. */
export const deploymentWorkflowRemovedReceived = createAction(
  '[Workspace Deployments] Workflow Removed Received',
  props<{ event: DeploymentWorkflowRemovedPayload }>(),
);

/** `deploymentRunUpsert`: run triggered / status changed. */
export const deploymentRunUpsertReceived = createAction(
  '[Workspace Deployments] Run Upsert Received',
  props<{ run: DeploymentRunSummary }>(),
);

export const clearWorkspaceDeploymentsError = createAction('[Workspace Deployments] Clear Error');

export const clearLastTriggeredDeploymentRun = createAction('[Workspace Deployments] Clear Last Triggered Run');
