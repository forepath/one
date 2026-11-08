import type { DeploymentRunSummary, DeploymentWorkflowSummary } from '@forepath/agenstra/shared/util-opencode-config';

import {
  approveDeploymentWorkflow,
  approveDeploymentWorkflowFailure,
  approveDeploymentWorkflowSuccess,
  cancelDeploymentRunSuccess,
  deleteDeploymentWorkflowSuccess,
  deploymentRunUpsertReceived,
  deploymentWorkflowRemovedReceived,
  deploymentWorkflowUpsertReceived,
  loadDeploymentRun,
  loadDeploymentRunLogs,
  loadDeploymentRunLogsSuccess,
  loadDeploymentRuns,
  loadDeploymentRunsSuccess,
  loadDeploymentRunSuccess,
  loadDeploymentWorkflow,
  loadDeploymentWorkflows,
  loadDeploymentWorkflowsSuccess,
  loadDeploymentWorkflowSuccess,
  triggerDeploymentWorkflow,
  triggerDeploymentWorkflowSuccess,
} from './workspace-deployments.actions';
import {
  initialWorkspaceDeploymentsState,
  workspaceDeploymentsReducer,
  type WorkspaceDeploymentsState,
} from './workspace-deployments.reducer';

function workflow(overrides: Partial<DeploymentWorkflowSummary> = {}): DeploymentWorkflowSummary {
  return {
    id: 'w1',
    clientId: 'c1',
    connectionId: 'k1',
    provider: 'github',
    connectionLabel: 'GitHub',
    name: 'Deploy',
    description: null,
    repository: 'org/api',
    workflow: 'deploy.yml',
    defaultRef: 'main',
    defaultInputs: {},
    scope: 'global',
    agentIds: [],
    agentTriggerEnabled: false,
    enabled: true,
    approvalStatus: 'approved',
    approvedAt: '2026-11-01T10:00:00.000Z',
    createdBy: 'user',
    updatedBy: 'user',
    createdByAgentId: null,
    lastRunStatus: null,
    lastRunConclusion: null,
    lastRunAt: null,
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-01T10:00:00.000Z',
    ...overrides,
  };
}

function run(overrides: Partial<DeploymentRunSummary> = {}): DeploymentRunSummary {
  return {
    id: 'r1',
    clientId: 'c1',
    workflowId: 'w1',
    workflowName: 'Deploy',
    agentId: null,
    providerRunId: '42',
    name: 'Deploy #42',
    status: 'queued',
    conclusion: null,
    ref: 'main',
    sha: null,
    url: null,
    inputs: {},
    triggeredBy: 'user',
    triggeredByUserId: 'u1',
    startedAt: null,
    completedAt: null,
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-01T10:00:00.000Z',
    ...overrides,
  };
}

function withWorkflows(): WorkspaceDeploymentsState {
  let state = workspaceDeploymentsReducer(
    initialWorkspaceDeploymentsState,
    loadDeploymentWorkflows({ clientId: 'c1', query: { limit: 25 } }),
  );

  state = workspaceDeploymentsReducer(
    state,
    loadDeploymentWorkflowsSuccess({ clientId: 'c1', workflows: [workflow()], hasNext: false }),
  );

  return state;
}

function withRuns(query = { workflowId: 'w1', limit: 2 }): WorkspaceDeploymentsState {
  let state = workspaceDeploymentsReducer(withWorkflows(), loadDeploymentRuns({ clientId: 'c1', query }));

  state = workspaceDeploymentsReducer(state, loadDeploymentRunsSuccess({ clientId: 'c1', runs: [run()], total: 1 }));

  return state;
}

describe('workspaceDeploymentsReducer', () => {
  it('resets the state for another workspace and ignores stale responses', () => {
    const state = workspaceDeploymentsReducer(withRuns(), loadDeploymentWorkflows({ clientId: 'c2', query: {} }));

    expect(state).toMatchObject({ clientId: 'c2', workflows: [], runs: [], workflowsLoading: true });
    expect(
      workspaceDeploymentsReducer(
        state,
        loadDeploymentWorkflowsSuccess({ clientId: 'c1', workflows: [workflow()], hasNext: false }),
      ).workflows,
    ).toEqual([]);
  });

  it('opens a workflow from the list and keeps the newer snapshot', () => {
    let state = workspaceDeploymentsReducer(
      withWorkflows(),
      loadDeploymentWorkflow({ clientId: 'c1', workflowId: 'w1' }),
    );

    expect(state.selectedWorkflow?.id).toBe('w1');
    state = workspaceDeploymentsReducer(
      state,
      deploymentWorkflowUpsertReceived({ workflow: workflow({ name: 'Live', updatedAt: '2026-11-02T00:00:00.000Z' }) }),
    );
    state = workspaceDeploymentsReducer(state, loadDeploymentWorkflowSuccess({ workflow: workflow({ name: 'Old' }) }));
    expect(state.selectedWorkflow?.name).toBe('Live');
    expect(state.workflows[0].name).toBe('Live');
  });

  it('tracks an approval and upserts the approved workflow (list and opened)', () => {
    const pending = workflow({ approvalStatus: 'pending', approvedAt: null, createdBy: 'agent', updatedBy: 'agent' });
    let state = workspaceDeploymentsReducer(withWorkflows(), deploymentWorkflowUpsertReceived({ workflow: pending }));

    state = workspaceDeploymentsReducer(state, loadDeploymentWorkflow({ clientId: 'c1', workflowId: 'w1' }));
    state = workspaceDeploymentsReducer(
      state,
      approveDeploymentWorkflow({ clientId: 'c1', workflowId: 'w1', updatedAt: pending.updatedAt }),
    );
    expect(state.approvingWorkflowIds).toEqual(['w1']);

    const approved = workflow({
      approvalStatus: 'approved',
      approvedAt: '2026-11-02T00:00:00.000Z',
      createdBy: 'agent',
      updatedAt: '2026-11-02T00:00:00.000Z',
    });

    state = workspaceDeploymentsReducer(state, approveDeploymentWorkflowSuccess({ workflow: approved }));
    expect(state.approvingWorkflowIds).toEqual([]);
    expect(state.workflows[0].approvalStatus).toBe('approved');
    expect(state.selectedWorkflow?.approvalStatus).toBe('approved');
  });

  it('keeps the backend message of a refused approval', () => {
    let state = workspaceDeploymentsReducer(
      withWorkflows(),
      approveDeploymentWorkflow({ clientId: 'c1', workflowId: 'w1', updatedAt: 't1' }),
    );

    state = workspaceDeploymentsReducer(
      state,
      approveDeploymentWorkflowFailure({ clientId: 'c1', workflowId: 'w1', error: 'Changed since', conflict: true }),
    );
    expect(state.approvingWorkflowIds).toEqual([]);
    expect(state.error).toBe('Changed since');
  });

  it('inserts live workflows only on an unfiltered first page', () => {
    const inserted = workspaceDeploymentsReducer(
      withWorkflows(),
      deploymentWorkflowUpsertReceived({ workflow: workflow({ id: 'w2' }) }),
    );

    expect(inserted.workflows.map((w) => w.id)).toEqual(['w2', 'w1']);

    let filtered = workspaceDeploymentsReducer(
      withWorkflows(),
      loadDeploymentWorkflows({ clientId: 'c1', query: { agentId: 'a1' } }),
    );

    filtered = workspaceDeploymentsReducer(
      filtered,
      deploymentWorkflowUpsertReceived({ workflow: workflow({ id: 'w3', scope: 'environments', agentIds: ['a2'] }) }),
    );
    expect(filtered.workflows.map((w) => w.id)).toEqual(['w1']);
    expect(
      workspaceDeploymentsReducer(
        filtered,
        deploymentWorkflowUpsertReceived({ workflow: workflow({ id: 'w4', clientId: 'other' }) }),
      ).workflows.map((w) => w.id),
    ).toEqual(['w1']);
  });

  it('removes a workflow with its runs (socket and delete)', () => {
    const selected = workspaceDeploymentsReducer(
      withRuns(),
      loadDeploymentWorkflow({ clientId: 'c1', workflowId: 'w1' }),
    );

    for (const state of [
      workspaceDeploymentsReducer(
        selected,
        deploymentWorkflowRemovedReceived({ event: { clientId: 'c1', workflowId: 'w1' } }),
      ),
      workspaceDeploymentsReducer(selected, deleteDeploymentWorkflowSuccess({ workflowId: 'w1' })),
    ]) {
      expect(state).toMatchObject({ workflows: [], runs: [], runsTotal: 0, selectedWorkflow: null });
    }
  });

  it('prepends live runs of the listed workflow and updates known ones', () => {
    let state = workspaceDeploymentsReducer(
      withRuns(),
      deploymentRunUpsertReceived({ run: run({ id: 'r2', createdAt: '2026-11-01T11:00:00.000Z' }) }),
    );

    expect(state.runs.map((r) => r.id)).toEqual(['r2', 'r1']);
    expect(state.runsTotal).toBe(2);

    // Page size 2: a third run pushes the oldest one off the page.
    state = workspaceDeploymentsReducer(state, deploymentRunUpsertReceived({ run: run({ id: 'r3' }) }));
    expect(state.runs.map((r) => r.id)).toEqual(['r3', 'r2']);

    state = workspaceDeploymentsReducer(
      state,
      deploymentRunUpsertReceived({
        run: run({ id: 'r2', status: 'completed', conclusion: 'success', updatedAt: '2026-11-01T12:00:00.000Z' }),
      }),
    );
    expect(state.runs[1]).toMatchObject({ status: 'completed', conclusion: 'success' });
    expect(
      workspaceDeploymentsReducer(state, deploymentRunUpsertReceived({ run: run({ id: 'r9', workflowId: 'w2' }) }))
        .runs,
    ).toHaveLength(2);
  });

  it('opens a run, keeps its jobs on refresh and follows live updates', () => {
    let state = workspaceDeploymentsReducer(withRuns(), loadDeploymentRun({ clientId: 'c1', runId: 'r1' }));

    expect(state.selectedRun).toEqual({ run: run(), jobs: [] });
    expect(state.selectedRunLoading).toBe(true);

    const job = {
      id: 'j1',
      name: 'build',
      status: 'in_progress' as const,
      conclusion: null,
      startedAt: null,
      completedAt: null,
      url: null,
    };

    state = workspaceDeploymentsReducer(
      state,
      loadDeploymentRunSuccess({ detail: { run: run({ status: 'in_progress' }), jobs: [job] } }),
    );
    expect(state.selectedRun?.jobs).toEqual([job]);
    state = workspaceDeploymentsReducer(state, loadDeploymentRun({ clientId: 'c1', runId: 'r1', refresh: true }));
    expect(state.selectedRun?.jobs).toEqual([job]);

    state = workspaceDeploymentsReducer(
      state,
      cancelDeploymentRunSuccess({
        run: run({ status: 'completed', conclusion: 'cancelled', updatedAt: '2026-11-01T13:00:00.000Z' }),
      }),
    );
    expect(state.selectedRun?.run.conclusion).toBe('cancelled');
    expect(state.runs[0].conclusion).toBe('cancelled');
  });

  it('remembers the triggered run', () => {
    let state = workspaceDeploymentsReducer(
      withRuns(),
      triggerDeploymentWorkflow({ clientId: 'c1', workflowId: 'w1', dto: {} }),
    );

    expect(state.triggering).toBe(true);
    state = workspaceDeploymentsReducer(state, triggerDeploymentWorkflowSuccess({ run: run({ id: 'r5' }) }));
    expect(state).toMatchObject({ triggering: false, lastTriggeredRun: { id: 'r5' } });
    expect(state.runs[0].id).toBe('r5');
  });

  it('keeps only the logs of the latest target', () => {
    let state = workspaceDeploymentsReducer(
      withRuns(),
      loadDeploymentRunLogs({ clientId: 'c1', runId: 'r1', jobId: 'j1' }),
    );

    state = workspaceDeploymentsReducer(state, loadDeploymentRunLogs({ clientId: 'c1', runId: 'r1', jobId: null }));
    state = workspaceDeploymentsReducer(
      state,
      loadDeploymentRunLogsSuccess({ runId: 'r1', jobId: 'j1', logs: { logs: 'job', truncated: false } }),
    );
    expect(state.logs).toBeNull();
    state = workspaceDeploymentsReducer(
      state,
      loadDeploymentRunLogsSuccess({ runId: 'r1', jobId: null, logs: { logs: 'run', truncated: true } }),
    );
    expect(state).toMatchObject({ logs: { logs: 'run', truncated: true }, logsLoading: false });
  });
});
