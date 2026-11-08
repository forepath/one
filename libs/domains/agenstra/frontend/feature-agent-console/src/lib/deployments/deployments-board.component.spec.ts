import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import {
  AgentsFacade,
  ClientsFacade,
  ContainerSocketFacade,
  WorkspaceDeploymentsFacade,
  WorkspaceDeploymentsService,
} from '@forepath/agenstra/frontend/data-access-agent-console';
import type {
  DeploymentRunDetail,
  DeploymentRunSummary,
  DeploymentWorkflowSummary,
} from '@forepath/agenstra/shared/util-opencode-config';
import { BehaviorSubject, NEVER, of, Subject } from 'rxjs';

import { DeploymentsBoardComponent } from './deployments-board.component';

function workflow(overrides: Partial<DeploymentWorkflowSummary> = {}): DeploymentWorkflowSummary {
  return {
    id: 'w1',
    clientId: 'client-1',
    connectionId: 'k1',
    provider: 'github',
    connectionLabel: 'GitHub',
    name: 'Deploy API',
    description: null,
    repository: 'org/api',
    workflow: 'deploy.yml',
    defaultRef: 'main',
    defaultInputs: { env: 'prod' },
    scope: 'environments',
    agentIds: ['agent-1'],
    agentTriggerEnabled: true,
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
    clientId: 'client-1',
    workflowId: 'w1',
    workflowName: 'Deploy API',
    agentId: null,
    providerRunId: '42',
    name: null,
    status: 'in_progress',
    conclusion: null,
    ref: 'main',
    sha: 'abcdef1234',
    url: 'https://github.com/org/api/actions/runs/42',
    inputs: {},
    triggeredBy: 'user',
    triggeredByUserId: 'u1',
    startedAt: '2026-11-01T10:00:00.000Z',
    completedAt: null,
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-01T10:00:00.000Z',
    ...overrides,
  };
}

function callableStream(): unknown {
  const stream = new Subject<never>();
  const fn = jest.fn(() => new Subject<never>());

  return Object.assign(fn, {
    subscribe: stream.subscribe.bind(stream),
    pipe: stream.pipe.bind(stream),
    lift: stream.lift.bind(stream),
    [Symbol.observable ?? '@@observable']: () => stream,
  });
}

function autoMock(base: Record<string, unknown> = {}): unknown {
  return new Proxy(base, {
    get: (target, prop) => {
      if (typeof prop !== 'string' || prop in target) return target[prop as string];

      target[prop] = prop.endsWith('$') ? callableStream() : jest.fn(() => NEVER);

      return target[prop];
    },
  });
}

describe('DeploymentsBoardComponent', () => {
  let fixture: ComponentFixture<DeploymentsBoardComponent>;
  let facade: Record<string, jest.Mock> & {
    selectedWorkflow$: BehaviorSubject<DeploymentWorkflowSummary | null>;
    selectedRun$: BehaviorSubject<DeploymentRunDetail | null>;
    runs$: BehaviorSubject<DeploymentRunSummary[]>;
    lastTriggeredRun$: BehaviorSubject<DeploymentRunSummary | null>;
  };

  async function create(
    queryParams: Record<string, string>,
    options: {
      canManage?: boolean;
      selected?: DeploymentWorkflowSummary | null;
      detail?: DeploymentRunDetail | null;
      workflows?: DeploymentWorkflowSummary[];
      runs?: DeploymentRunSummary[];
    } = {},
  ): Promise<void> {
    const route = {
      snapshot: {
        queryParamMap: convertToParamMap(queryParams),
        paramMap: convertToParamMap({ clientId: 'client-1' }),
      },
      paramMap: new BehaviorSubject(convertToParamMap({ clientId: 'client-1' })),
      queryParamMap: new BehaviorSubject(convertToParamMap(queryParams)),
      parent: null,
    };

    facade = autoMock({
      workflows$: new BehaviorSubject(options.workflows ?? [workflow()]),
      workflowsHasNext$: new BehaviorSubject(false),
      workflowsLoading$: new BehaviorSubject(false),
      selectedWorkflow$: new BehaviorSubject(options.selected ?? null),
      selectedWorkflowLoading$: new BehaviorSubject(false),
      runs$: new BehaviorSubject(options.runs ?? [run()]),
      runsTotal$: new BehaviorSubject(1),
      runsLoading$: new BehaviorSubject(false),
      selectedRun$: new BehaviorSubject(options.detail ?? null),
      selectedRunLoading$: new BehaviorSubject(false),
      logs$: new BehaviorSubject(null),
      logsTarget$: new BehaviorSubject(null),
      logsLoading$: new BehaviorSubject(false),
      logsError$: new BehaviorSubject(null),
      connectionOptions$: new BehaviorSubject([]),
      connectionOptionsLoading$: new BehaviorSubject(false),
      saving$: new BehaviorSubject(false),
      triggering$: new BehaviorSubject(false),
      lastTriggeredRun$: new BehaviorSubject<DeploymentRunSummary | null>(null),
      syncingWorkflowIds$: new BehaviorSubject([]),
      cancellingRunIds$: new BehaviorSubject([]),
      approvingWorkflowIds$: new BehaviorSubject([]),
      error$: new BehaviorSubject(null),
      loadWorkflows: jest.fn(),
      openWorkflow: jest.fn(),
      closeWorkflow: jest.fn(),
      loadRuns: jest.fn(),
      openRun: jest.fn(),
      closeRun: jest.fn(),
      loadLogs: jest.fn(),
      cancelRun: jest.fn(),
      trigger: jest.fn(),
      approveWorkflow: jest.fn(),
      clearError: jest.fn(),
      clearLastTriggeredRun: jest.fn(),
    }) as typeof facade;

    await TestBed.configureTestingModule({
      imports: [DeploymentsBoardComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: route },
        { provide: WorkspaceDeploymentsFacade, useValue: facade },
        { provide: WorkspaceDeploymentsService, useValue: autoMock() },
        {
          provide: ClientsFacade,
          useValue: autoMock({
            clients$: new BehaviorSubject([
              { id: 'client-1', name: 'Workspace', canManageWorkspaceConfiguration: options.canManage ?? false },
            ]),
            activeClientId$: new BehaviorSubject('client-1'),
          }),
        },
        {
          provide: AgentsFacade,
          useValue: autoMock({
            getClientAgents$: jest.fn(() =>
              of([
                { id: 'agent-1', name: 'Primary' },
                { id: 'agent-2', name: 'Secondary' },
              ]),
            ),
          }),
        },
        {
          provide: ContainerSocketFacade,
          useValue: autoMock({ connected$: new BehaviorSubject(true), setClient: jest.fn() }),
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DeploymentsBoardComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const query = (selector: string): HTMLElement | null => fixture.nativeElement.querySelector(selector);

  afterEach(() => TestBed.resetTestingModule());

  it('loads the workflows of the workspace, filtered by environment', async () => {
    await create({ agentId: 'agent-2' });

    expect(facade.loadWorkflows).toHaveBeenLastCalledWith('client-1', {
      agentId: 'agent-2',
      approvalStatus: null,
      search: '',
      limit: 25,
      offset: 0,
    });
    expect(facade.loadRuns).not.toHaveBeenCalled();
  });

  it('filters pipelines by approval status and clears both filters', async () => {
    const navigate = jest.spyOn(Router.prototype, 'navigate').mockResolvedValue(true);

    await create({ agentId: 'agent-2', approval: 'pending' });

    expect(facade.loadWorkflows).toHaveBeenLastCalledWith(
      'client-1',
      expect.objectContaining({ approvalStatus: 'pending' }),
    );
    expect(fixture.componentInstance.workflowFiltersActive()).toBe(2);

    fixture.componentInstance.onApprovalFilterChange('bogus');
    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { approval: null } }));
    fixture.componentInstance.onClearWorkflowFilters();
    expect(navigate).toHaveBeenLastCalledWith(
      [],
      expect.objectContaining({ queryParams: { agentId: null, approval: null } }),
    );
    navigate.mockRestore();
  });

  it('hides workflow management from members without workspace management', async () => {
    await create({ workflowId: 'w1' }, { selected: workflow() });

    expect(facade.openWorkflow).toHaveBeenCalledWith('client-1', 'w1');
    expect(query('[data-testid="deployment-workflow-overview"]')).not.toBeNull();
    expect(query('[data-testid="deployment-workflow-trigger"]')).not.toBeNull();
    expect(query('[data-testid="deployment-workflow-edit"]')).toBeNull();
    expect(query('[data-testid="deployment-workflow-create"]')).toBeNull();
    expect(query('[data-testid="deployment-workflow-enabled"]')).toBeNull();
    expect(fixture.componentInstance.workflowRowMenu(workflow()).map((item) => item.id)).toEqual([
      'open',
      'trigger',
      'copy-id',
    ]);
  });

  it('offers workflow management to workspace admins', async () => {
    await create({ workflowId: 'w1' }, { canManage: true, selected: workflow() });

    expect(query('[data-testid="deployment-workflow-edit"]')).not.toBeNull();
    expect(query('[data-testid="deployment-workflow-create"]')).not.toBeNull();
    expect(fixture.componentInstance.workflowRowMenu(workflow()).map((item) => item.id)).toEqual([
      'open',
      'trigger',
      'edit',
      'copy-id',
      'delete',
    ]);
  });

  it('shows the scope and loads the run history of the opened workflow', async () => {
    await create({ workflowId: 'w1' }, { selected: workflow() });

    expect(query('[data-testid="deployment-workflow-scope"]')?.textContent).toContain('Primary');
    expect(facade.loadRuns).toHaveBeenLastCalledWith('client-1', {
      workflowId: 'w1',
      search: '',
      status: null,
      limit: 25,
      offset: 0,
    });

    fixture.componentInstance.onRunStatusFilterChange('completed');
    fixture.detectChanges();
    expect(facade.loadRuns).toHaveBeenLastCalledWith('client-1', expect.objectContaining({ status: 'completed' }));
  });

  it('opens a run without its workflow (audit deep link) and resolves the workflow', async () => {
    const navigate = jest.spyOn(Router.prototype, 'navigate').mockResolvedValue(true);

    await create({ runId: 'r1' }, { detail: { run: run(), jobs: [] } });

    expect(facade.openRun).toHaveBeenCalledWith('client-1', 'r1');
    expect(navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ queryParams: { workflowId: 'w1' }, replaceUrl: true }),
    );
    navigate.mockRestore();
  });

  it('cancels an active run after confirmation and opens its logs', async () => {
    await create({ workflowId: 'w1', runId: 'r1' }, { selected: workflow(), detail: { run: run(), jobs: [] } });

    expect(query('[data-testid="deployment-run-cancel"]')).not.toBeNull();
    // The run opens in its own column next to the workflow (overview + run history stay visible).
    expect(query('[data-testid="deployment-run-column"]')).not.toBeNull();
    expect(query('[data-testid="deployment-workflow-overview"]')).not.toBeNull();

    const component = fixture.componentInstance;

    component.onRequestCancel(run());
    expect(component.cancelConfirmOpen()).toBe(true);
    component.onConfirmCancel();
    expect(facade.cancelRun).toHaveBeenCalledWith('client-1', 'r1');

    component.onViewLogs('r1', null);
    expect(facade.loadLogs).toHaveBeenCalledWith('client-1', 'r1', null);
    expect(component.logsModalOpen()).toBe(true);
  });

  it('toggles the run column from the run history (no close button on wide screens)', async () => {
    const navigate = jest.spyOn(Router.prototype, 'navigate').mockResolvedValue(true);

    await create({ workflowId: 'w1', runId: 'r1' }, { selected: workflow(), detail: { run: run(), jobs: [] } });

    const component = fixture.componentInstance;

    // Only the phone back button exists (hidden from md up).
    expect(query('[data-testid="deployment-run-back"]')?.classList.contains('d-md-none')).toBe(true);

    component.onRunRowActivate(run());
    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { runId: null } }));

    component.onRunRowActivate(run({ id: 'r2' }));
    expect(navigate).toHaveBeenLastCalledWith(
      [],
      expect.objectContaining({ queryParams: { workflowId: 'w1', runId: 'r2' } }),
    );
    navigate.mockRestore();
  });

  it('searches the jobs of the opened run (newest first)', async () => {
    const jobs = [
      {
        id: '1',
        name: 'build',
        status: 'completed',
        conclusion: 'success',
        startedAt: '2026-01-01T10:00:00.000Z',
        completedAt: null,
        url: null,
      },
      {
        id: '2',
        name: 'deploy',
        status: 'in_progress',
        conclusion: null,
        startedAt: '2026-01-01T11:00:00.000Z',
        completedAt: null,
        url: null,
      },
    ] as DeploymentRunDetail['jobs'];

    await create({ workflowId: 'w1', runId: 'r1' }, { selected: workflow(), detail: { run: run(), jobs } });

    const component = fixture.componentInstance;

    expect(component.searchedJobs().map((job) => job.id)).toEqual(['2', '1']);
    component.jobSearch.set('BUILD');
    expect(component.searchedJobs().map((job) => job.id)).toEqual(['1']);
  });

  it('triggers a run and opens it once created', async () => {
    const navigate = jest.spyOn(Router.prototype, 'navigate').mockResolvedValue(true);

    await create({ workflowId: 'w1' }, { selected: workflow() });

    const component = fixture.componentInstance;

    component.openTrigger(workflow());
    component.onTrigger({ ref: 'release', inputs: { env: 'prod' } });
    expect(facade.trigger).toHaveBeenCalledWith('client-1', 'w1', { ref: 'release', inputs: { env: 'prod' } });

    facade.lastTriggeredRun$.next(run({ id: 'r9' }));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(facade.clearLastTriggeredRun).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ queryParams: { workflowId: 'w1', runId: 'r9' } }),
    );
    navigate.mockRestore();
  });

  it('does not offer triggering a disabled workflow', async () => {
    await create({ workflowId: 'w1' }, { selected: workflow({ enabled: false }) });

    fixture.componentInstance.openTrigger(workflow({ enabled: false }));
    expect(fixture.componentInstance.triggerOpen()).toBe(false);
  });

  describe('workflows waiting for approval', () => {
    const pending = (overrides: Partial<DeploymentWorkflowSummary> = {}) =>
      workflow({
        approvalStatus: 'pending',
        approvedAt: null,
        createdBy: 'agent',
        updatedBy: 'agent',
        createdByAgentId: 'agent-1',
        updatedAt: '2026-11-03T09:00:00.000Z',
        ...overrides,
      });

    it('shows the pending state, who proposed it, and blocks runs for members', async () => {
      await create({ workflowId: 'w1' }, { selected: pending(), workflows: [pending()] });

      const component = fixture.componentInstance;

      expect(component.workflowState(pending())).toMatchObject({ label: 'Waiting for approval', tone: 'warning' });
      expect(query('[data-testid="deployment-workflow-pending-badge"]')).not.toBeNull();
      expect(query('[data-testid="deployment-workflow-pending"]')?.textContent).toContain(
        'Changed by environment Primary',
      );
      expect(query('[data-testid="deployment-workflow-proposed-by"]')?.textContent).toContain('Environment Primary');
      expect(query('[data-testid="deployment-workflow-approve"]')).toBeNull();
      expect(query('[data-testid="deployment-workflow-pending-approve"]')).toBeNull();

      const trigger = query('[data-testid="deployment-workflow-trigger"] button');

      expect(trigger?.hasAttribute('disabled')).toBe(true);
      expect(trigger?.getAttribute('title')).toBe(component.triggerPendingTitle);

      const triggerItem = component.workflowRowMenu(pending()).find((item) => item.id === 'trigger');

      expect(triggerItem?.disabled).toBe(true);
      expect(component.workflowRowMenu(pending()).some((item) => item.id === 'approve')).toBe(false);

      component.openTrigger(pending());
      expect(component.triggerOpen()).toBe(false);

      component.onRequestApprove(pending());
      expect(component.approveConfirmOpen()).toBe(false);
    });

    it('says "Proposed by" for a new proposal that was not changed by the environment since', async () => {
      const proposal = pending({ updatedBy: 'user', createdByAgentId: 'agent-2', agentIds: ['agent-2'] });

      await create({ workflowId: 'w1' }, { selected: proposal });

      expect(query('[data-testid="deployment-workflow-pending"]')?.textContent).toContain(
        'Proposed by environment Secondary',
      );
    });

    it('says "Proposed by" for an untouched proposal of the environment itself', async () => {
      const fresh = pending({ createdAt: '2026-11-03T09:00:00.000Z', updatedAt: '2026-11-03T09:00:00.000Z' });

      await create({ workflowId: 'w1' }, { selected: fresh });

      expect(query('[data-testid="deployment-workflow-pending"]')?.textContent).toContain(
        'Proposed by environment Primary',
      );
    });

    it('lets workspace admins approve the reviewed version after confirming what is approved', async () => {
      await create({ workflowId: 'w1' }, { canManage: true, selected: pending(), workflows: [pending()] });

      const component = fixture.componentInstance;

      expect(query('[data-testid="deployment-workflow-approve"]')).not.toBeNull();
      // One approve action in the header (and the row menu); the banner only explains.
      expect(query('[data-testid="deployment-workflow-pending-approve"]')).toBeNull();
      expect(component.workflowRowMenu(pending()).map((item) => item.id)).toEqual([
        'open',
        'trigger',
        'approve',
        'edit',
        'copy-id',
        'delete',
      ]);

      component.onWorkflowRowAction(pending(), 'approve');
      expect(component.approveConfirmOpen()).toBe(true);
      expect(component.workflowPendingApproval()?.id).toBe('w1');
      expect(component.approvalInputs()).toEqual([['env', 'prod']]);
      expect(component.approvalAssignedAgentNames()).toEqual(['Primary']);
      expect(facade.approveWorkflow).not.toHaveBeenCalled();

      component.onConfirmApprove();
      expect(facade.approveWorkflow).toHaveBeenCalledWith('client-1', 'w1', '2026-11-03T09:00:00.000Z');
      expect(component.approveConfirmOpen()).toBe(false);
    });

    it('does not offer approving an approved workflow', async () => {
      await create({ workflowId: 'w1' }, { canManage: true, selected: workflow() });

      expect(query('[data-testid="deployment-workflow-approve"]')).toBeNull();
      expect(query('[data-testid="deployment-workflow-pending"]')).toBeNull();
      fixture.componentInstance.onRequestApprove(workflow());
      expect(fixture.componentInstance.approveConfirmOpen()).toBe(false);
    });
  });

  it('lists runs and jobs newest first by start time, also after live upserts', async () => {
    const older = run({ id: 'r-old', startedAt: '2026-11-01T08:00:00.000Z', createdAt: '2026-11-01T08:00:00.000Z' });
    const newer = run({ id: 'r-new', startedAt: '2026-11-02T08:00:00.000Z', createdAt: '2026-11-02T08:00:00.000Z' });

    await create(
      { workflowId: 'w1', runId: 'r-new' },
      {
        selected: workflow(),
        runs: [older, newer],
        detail: {
          run: newer,
          jobs: [
            {
              id: 'j1',
              name: 'build',
              status: 'completed',
              conclusion: 'success',
              startedAt: '2026-11-02T08:00:00.000Z',
              completedAt: null,
              url: null,
            },
            {
              id: 'j3',
              name: 'later',
              status: 'queued',
              conclusion: null,
              startedAt: null,
              completedAt: null,
              url: null,
            },
            {
              id: 'j2',
              name: 'deploy',
              status: 'in_progress',
              conclusion: null,
              startedAt: '2026-11-02T08:05:00.000Z',
              completedAt: null,
              url: null,
            },
          ],
        },
      },
    );

    const component = fixture.componentInstance;

    expect(component.sortedRuns().map((entry) => entry.id)).toEqual(['r-new', 'r-old']);
    expect(component.sortedJobs().map((job) => job.id)).toEqual(['j2', 'j1', 'j3']);
    expect(component.jobSort()).toEqual({ column: 'started', direction: 'desc' });

    // A live upsert of a queued run (not started yet) lands on top.
    facade.runs$.next([
      older,
      newer,
      run({ id: 'r-queued', status: 'queued', startedAt: null, createdAt: '2026-11-03T08:00:00.000Z' }),
    ]);
    fixture.detectChanges();
    expect(component.sortedRuns().map((entry) => entry.id)).toEqual(['r-queued', 'r-new', 'r-old']);
  });
});
