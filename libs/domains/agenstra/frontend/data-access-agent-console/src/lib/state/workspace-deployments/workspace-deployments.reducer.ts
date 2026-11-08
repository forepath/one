import type {
  DeploymentConnectionOption,
  DeploymentRunDetail,
  DeploymentRunLogs,
  DeploymentRunSummary,
  DeploymentWorkflowSummary,
} from '@forepath/agenstra/shared/util-opencode-config';
import { createReducer, on } from '@ngrx/store';

import {
  approveDeploymentWorkflow,
  approveDeploymentWorkflowFailure,
  approveDeploymentWorkflowSuccess,
  cancelDeploymentRun,
  cancelDeploymentRunFailure,
  cancelDeploymentRunSuccess,
  clearDeploymentRunLogs,
  clearLastTriggeredDeploymentRun,
  clearSelectedDeploymentRun,
  clearSelectedDeploymentWorkflow,
  clearWorkspaceDeploymentsError,
  createDeploymentWorkflow,
  createDeploymentWorkflowSuccess,
  deleteDeploymentWorkflow,
  deleteDeploymentWorkflowSuccess,
  deploymentRunUpsertReceived,
  deploymentWorkflowRemovedReceived,
  deploymentWorkflowUpsertReceived,
  loadDeploymentConnectionOptions,
  loadDeploymentConnectionOptionsFailure,
  loadDeploymentConnectionOptionsSuccess,
  loadDeploymentRun,
  loadDeploymentRunFailure,
  loadDeploymentRunLogs,
  loadDeploymentRunLogsFailure,
  loadDeploymentRunLogsSuccess,
  loadDeploymentRuns,
  loadDeploymentRunsFailure,
  loadDeploymentRunsSuccess,
  loadDeploymentRunSuccess,
  loadDeploymentWorkflow,
  loadDeploymentWorkflowFailure,
  loadDeploymentWorkflows,
  loadDeploymentWorkflowsFailure,
  loadDeploymentWorkflowsSuccess,
  loadDeploymentWorkflowSuccess,
  saveDeploymentWorkflowFailure,
  syncDeploymentWorkflow,
  syncDeploymentWorkflowFailure,
  syncDeploymentWorkflowSuccess,
  triggerDeploymentWorkflow,
  triggerDeploymentWorkflowFailure,
  triggerDeploymentWorkflowSuccess,
  updateDeploymentWorkflow,
  updateDeploymentWorkflowSuccess,
} from './workspace-deployments.actions';
import type {
  DeploymentLogsTarget,
  DeploymentRunsQuery,
  DeploymentWorkflowsQuery,
} from './workspace-deployments.types';

export interface WorkspaceDeploymentsState {
  /** Workspace of the listed workflows / runs (another workspace resets the state). */
  clientId: string | null;
  workflows: DeploymentWorkflowSummary[];
  workflowsQuery: DeploymentWorkflowsQuery;
  /** Server paging without a total: a full page means there may be a next one. */
  workflowsHasNext: boolean;
  workflowsLoading: boolean;
  selectedWorkflow: DeploymentWorkflowSummary | null;
  selectedWorkflowLoading: boolean;
  runs: DeploymentRunSummary[];
  runsQuery: DeploymentRunsQuery;
  runsTotal: number;
  runsLoading: boolean;
  selectedRun: DeploymentRunDetail | null;
  selectedRunLoading: boolean;
  logs: DeploymentRunLogs | null;
  logsTarget: DeploymentLogsTarget | null;
  logsLoading: boolean;
  logsError: string | null;
  connectionOptions: DeploymentConnectionOption[];
  connectionOptionsLoading: boolean;
  saving: boolean;
  triggering: boolean;
  /** Run started by the latest trigger of this console (the page opens it). */
  lastTriggeredRun: DeploymentRunSummary | null;
  syncingWorkflowIds: string[];
  /** Workflows whose approval request is in flight. */
  approvingWorkflowIds: string[];
  cancellingRunIds: string[];
  error: string | null;
}

export const initialWorkspaceDeploymentsState: WorkspaceDeploymentsState = {
  clientId: null,
  workflows: [],
  workflowsQuery: {},
  workflowsHasNext: false,
  workflowsLoading: false,
  selectedWorkflow: null,
  selectedWorkflowLoading: false,
  runs: [],
  runsQuery: {},
  runsTotal: 0,
  runsLoading: false,
  selectedRun: null,
  selectedRunLoading: false,
  logs: null,
  logsTarget: null,
  logsLoading: false,
  logsError: null,
  connectionOptions: [],
  connectionOptionsLoading: false,
  saving: false,
  triggering: false,
  lastTriggeredRun: null,
  syncingWorkflowIds: [],
  approvingWorkflowIds: [],
  cancellingRunIds: [],
  error: null,
};

/** Live socket snapshots and REST responses can arrive out of order: an older snapshot never replaces a newer one. */
function newer<T extends { updatedAt: string }>(current: T, incoming: T): T {
  return incoming.updatedAt >= current.updatedAt ? incoming : current;
}

function forClient(state: WorkspaceDeploymentsState, clientId: string): WorkspaceDeploymentsState {
  return state.clientId === clientId ? state : { ...initialWorkspaceDeploymentsState, clientId };
}

/** Whether a workflow belongs on the listed page (first page, no search; environment filter: global or assigned). */
function workflowMatchesListedPage(state: WorkspaceDeploymentsState, workflow: DeploymentWorkflowSummary): boolean {
  const query = state.workflowsQuery;

  if (query.offset || query.search?.trim()) {
    return false;
  }

  return !query.agentId || workflow.scope === 'global' || workflow.agentIds.includes(query.agentId);
}

function mergeWorkflow(
  state: WorkspaceDeploymentsState,
  workflow: DeploymentWorkflowSummary,
  insert: boolean,
): WorkspaceDeploymentsState {
  if (workflow.clientId !== state.clientId) {
    return state;
  }

  const listed = state.workflows.some((existing) => existing.id === workflow.id);
  const workflows = listed
    ? state.workflows.map((existing) => (existing.id === workflow.id ? newer(existing, workflow) : existing))
    : insert && workflowMatchesListedPage(state, workflow)
      ? [workflow, ...state.workflows]
      : state.workflows;
  const selectedWorkflow =
    state.selectedWorkflow?.id === workflow.id ? newer(state.selectedWorkflow, workflow) : state.selectedWorkflow;

  return { ...state, workflows, selectedWorkflow };
}

function withoutWorkflow(state: WorkspaceDeploymentsState, workflowId: string): WorkspaceDeploymentsState {
  const runs = state.runs.filter((run) => run.workflowId !== workflowId);

  return {
    ...state,
    workflows: state.workflows.filter((workflow) => workflow.id !== workflowId),
    selectedWorkflow: state.selectedWorkflow?.id === workflowId ? null : state.selectedWorkflow,
    runs,
    runsTotal: Math.max(0, state.runsTotal - (state.runs.length - runs.length)),
    selectedRun: state.selectedRun?.run.workflowId === workflowId ? null : state.selectedRun,
  };
}

/** Whether a new run belongs on the listed runs page (first page, no search, matching workflow / status filter). */
function runMatchesListedPage(state: WorkspaceDeploymentsState, run: DeploymentRunSummary): boolean {
  const query = state.runsQuery;

  return (
    !query.offset &&
    !query.search?.trim() &&
    (!query.workflowId || query.workflowId === run.workflowId) &&
    (!query.agentId || query.agentId === run.agentId) &&
    (!query.status || query.status === run.status)
  );
}

function mergeRun(state: WorkspaceDeploymentsState, run: DeploymentRunSummary): WorkspaceDeploymentsState {
  if (run.clientId !== state.clientId) {
    return state;
  }

  let runs = state.runs;
  let runsTotal = state.runsTotal;

  if (state.runs.some((existing) => existing.id === run.id)) {
    runs = state.runs.map((existing) => (existing.id === run.id ? newer(existing, run) : existing));
  } else if (runMatchesListedPage(state, run)) {
    runs = [run, ...state.runs].slice(0, state.runsQuery.limit ?? Number.MAX_SAFE_INTEGER);
    runsTotal = state.runsTotal + 1;
  }

  const selectedRun =
    state.selectedRun && state.selectedRun.run.id === run.id
      ? { ...state.selectedRun, run: newer(state.selectedRun.run, run) }
      : state.selectedRun;

  return { ...state, runs, runsTotal, selectedRun };
}

export const workspaceDeploymentsReducer = createReducer(
  initialWorkspaceDeploymentsState,
  // --- workflows ---
  on(loadDeploymentWorkflows, (state, { clientId, query }) => ({
    ...forClient(state, clientId),
    workflowsQuery: query,
    workflowsLoading: true,
    error: null,
  })),
  on(loadDeploymentWorkflowsSuccess, (state, { clientId, workflows, hasNext }) =>
    state.clientId === clientId ? { ...state, workflows, workflowsHasNext: hasNext, workflowsLoading: false } : state,
  ),
  on(loadDeploymentWorkflowsFailure, (state, { error }) => ({ ...state, workflowsLoading: false, error })),
  on(loadDeploymentWorkflow, (state, { clientId, workflowId }) => {
    const scoped = forClient(state, clientId);

    return {
      ...scoped,
      selectedWorkflow:
        scoped.selectedWorkflow?.id === workflowId
          ? scoped.selectedWorkflow
          : (scoped.workflows.find((workflow) => workflow.id === workflowId) ?? null),
      selectedWorkflowLoading: true,
    };
  }),
  on(loadDeploymentWorkflowSuccess, (state, { workflow }) =>
    workflow.clientId === state.clientId
      ? {
          ...mergeWorkflow(state, workflow, false),
          selectedWorkflow:
            state.selectedWorkflow?.id === workflow.id ? newer(state.selectedWorkflow, workflow) : workflow,
          selectedWorkflowLoading: false,
        }
      : state,
  ),
  on(loadDeploymentWorkflowFailure, (state, { workflowId, error }) => ({
    ...state,
    selectedWorkflow: state.selectedWorkflow?.id === workflowId ? null : state.selectedWorkflow,
    selectedWorkflowLoading: false,
    error,
  })),
  on(clearSelectedDeploymentWorkflow, (state) => ({
    ...state,
    selectedWorkflow: null,
    selectedWorkflowLoading: false,
  })),
  on(createDeploymentWorkflow, updateDeploymentWorkflow, deleteDeploymentWorkflow, (state) => ({
    ...state,
    saving: true,
    error: null,
  })),
  on(createDeploymentWorkflowSuccess, (state, { workflow }) => ({
    ...mergeWorkflow(state, workflow, true),
    saving: false,
  })),
  on(updateDeploymentWorkflowSuccess, (state, { workflow }) => ({
    ...mergeWorkflow(state, workflow, false),
    saving: false,
  })),
  on(deleteDeploymentWorkflowSuccess, (state, { workflowId }) => ({
    ...withoutWorkflow(state, workflowId),
    saving: false,
  })),
  on(saveDeploymentWorkflowFailure, (state, { error }) => ({ ...state, saving: false, error })),
  on(approveDeploymentWorkflow, (state, { workflowId }) => ({
    ...state,
    approvingWorkflowIds: [...state.approvingWorkflowIds.filter((id) => id !== workflowId), workflowId],
    error: null,
  })),
  on(approveDeploymentWorkflowSuccess, (state, { workflow }) => ({
    ...mergeWorkflow(state, workflow, false),
    approvingWorkflowIds: state.approvingWorkflowIds.filter((id) => id !== workflow.id),
  })),
  on(approveDeploymentWorkflowFailure, (state, { workflowId, error }) => ({
    ...state,
    approvingWorkflowIds: state.approvingWorkflowIds.filter((id) => id !== workflowId),
    error,
  })),
  on(triggerDeploymentWorkflow, (state) => ({ ...state, triggering: true, lastTriggeredRun: null, error: null })),
  on(triggerDeploymentWorkflowSuccess, (state, { run }) => ({
    ...mergeRun(state, run),
    triggering: false,
    lastTriggeredRun: run,
  })),
  on(triggerDeploymentWorkflowFailure, (state, { error }) => ({ ...state, triggering: false, error })),
  on(clearLastTriggeredDeploymentRun, (state) => ({ ...state, lastTriggeredRun: null })),
  on(syncDeploymentWorkflow, (state, { workflowId }) => ({
    ...state,
    syncingWorkflowIds: [...state.syncingWorkflowIds.filter((id) => id !== workflowId), workflowId],
    error: null,
  })),
  on(syncDeploymentWorkflowSuccess, (state, { workflowId }) => ({
    ...state,
    syncingWorkflowIds: state.syncingWorkflowIds.filter((id) => id !== workflowId),
  })),
  on(syncDeploymentWorkflowFailure, (state, { workflowId, error }) => ({
    ...state,
    syncingWorkflowIds: state.syncingWorkflowIds.filter((id) => id !== workflowId),
    error,
  })),
  // --- runs ---
  on(loadDeploymentRuns, (state, { clientId, query }) => {
    const scoped = forClient(state, clientId);
    const sameList = scoped.runsQuery.workflowId === query.workflowId && scoped.runsQuery.agentId === query.agentId;

    return {
      ...scoped,
      // Another workflow: never show the previous workflow's runs while loading.
      runs: sameList ? scoped.runs : [],
      runsTotal: sameList ? scoped.runsTotal : 0,
      runsQuery: query,
      runsLoading: true,
      error: null,
    };
  }),
  on(loadDeploymentRunsSuccess, (state, { clientId, runs, total }) =>
    state.clientId === clientId ? { ...state, runs, runsTotal: total, runsLoading: false } : state,
  ),
  on(loadDeploymentRunsFailure, (state, { error }) => ({ ...state, runsLoading: false, error })),
  on(loadDeploymentRun, (state, { clientId, runId, refresh }) => {
    const scoped = forClient(state, clientId);

    if (refresh && scoped.selectedRun?.run.id === runId) {
      return scoped;
    }

    const listed = scoped.runs.find((run) => run.id === runId);

    return {
      ...scoped,
      selectedRun:
        scoped.selectedRun?.run.id === runId ? scoped.selectedRun : listed ? { run: listed, jobs: [] } : null,
      selectedRunLoading: true,
    };
  }),
  on(loadDeploymentRunSuccess, (state, { detail }) => {
    if (detail.run.clientId !== state.clientId) {
      return state;
    }

    const merged = mergeRun(state, detail.run);

    return {
      ...merged,
      selectedRun: {
        run: state.selectedRun?.run.id === detail.run.id ? newer(state.selectedRun.run, detail.run) : detail.run,
        jobs: detail.jobs,
      },
      selectedRunLoading: false,
    };
  }),
  on(loadDeploymentRunFailure, (state, { runId, error }) => ({
    ...state,
    selectedRunLoading: false,
    selectedRun: state.selectedRun?.run.id === runId && state.selectedRun.jobs.length === 0 ? null : state.selectedRun,
    error,
  })),
  on(clearSelectedDeploymentRun, (state) => ({
    ...state,
    selectedRun: null,
    selectedRunLoading: false,
    logs: null,
    logsTarget: null,
    logsLoading: false,
    logsError: null,
  })),
  on(loadDeploymentRunLogs, (state, { runId, jobId }) => ({
    ...state,
    logsTarget: { runId, jobId },
    logs: state.logsTarget?.runId === runId && state.logsTarget.jobId === jobId ? state.logs : null,
    logsLoading: true,
    logsError: null,
  })),
  on(loadDeploymentRunLogsSuccess, (state, { runId, jobId, logs }) =>
    state.logsTarget?.runId === runId && state.logsTarget.jobId === jobId
      ? { ...state, logs, logsLoading: false }
      : state,
  ),
  on(loadDeploymentRunLogsFailure, (state, { runId, jobId, error }) =>
    state.logsTarget?.runId === runId && state.logsTarget.jobId === jobId
      ? { ...state, logsLoading: false, logsError: error }
      : state,
  ),
  on(clearDeploymentRunLogs, (state) => ({
    ...state,
    logs: null,
    logsTarget: null,
    logsLoading: false,
    logsError: null,
  })),
  on(cancelDeploymentRun, (state, { runId }) => ({
    ...state,
    cancellingRunIds: [...state.cancellingRunIds.filter((id) => id !== runId), runId],
    error: null,
  })),
  on(cancelDeploymentRunSuccess, (state, { run }) => ({
    ...mergeRun(state, run),
    cancellingRunIds: state.cancellingRunIds.filter((id) => id !== run.id),
  })),
  on(cancelDeploymentRunFailure, (state, { runId, error }) => ({
    ...state,
    cancellingRunIds: state.cancellingRunIds.filter((id) => id !== runId),
    error,
  })),
  // --- connection options ---
  on(loadDeploymentConnectionOptions, (state, { clientId }) => ({
    ...forClient(state, clientId),
    connectionOptionsLoading: true,
  })),
  on(loadDeploymentConnectionOptionsSuccess, (state, { clientId, connections }) =>
    state.clientId === clientId ? { ...state, connectionOptions: connections, connectionOptionsLoading: false } : state,
  ),
  on(loadDeploymentConnectionOptionsFailure, (state, { error }) => ({
    ...state,
    connectionOptionsLoading: false,
    error,
  })),
  // --- live ---
  on(deploymentWorkflowUpsertReceived, (state, { workflow }) => mergeWorkflow(state, workflow, true)),
  on(deploymentWorkflowRemovedReceived, (state, { event }) =>
    event.clientId === state.clientId ? withoutWorkflow(state, event.workflowId) : state,
  ),
  on(deploymentRunUpsertReceived, (state, { run }) => mergeRun(state, run)),
  on(clearWorkspaceDeploymentsError, (state) => ({ ...state, error: null })),
);
