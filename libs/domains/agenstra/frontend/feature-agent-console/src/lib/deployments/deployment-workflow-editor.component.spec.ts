import { TestBed } from '@angular/core/testing';
import {
  WorkspaceDeploymentsFacade,
  WorkspaceDeploymentsService,
} from '@forepath/agenstra/frontend/data-access-agent-console';
import { BehaviorSubject, of } from 'rxjs';

import { DeploymentWorkflowEditorComponent } from './deployment-workflow-editor.component';

describe('DeploymentWorkflowEditorComponent', () => {
  it('loads connection options and emits a workflow for selected environments', async () => {
    const facade = {
      connectionOptions$: new BehaviorSubject([
        { id: 'k1', label: 'GitHub', provider: 'github', lastTestStatus: 'ok' },
        { id: 'k2', label: 'GitLab', provider: 'gitlab', lastTestStatus: 'ok' },
      ]),
      connectionOptionsLoading$: new BehaviorSubject(false),
      loadConnectionOptions: jest.fn(),
    };
    const service = {
      listRepositories: jest.fn(() => of([])),
      listBranches: jest.fn(() => of([{ name: 'main', sha: null, default: true }])),
      listProviderWorkflows: jest.fn(() =>
        of([{ id: '7', name: 'Deploy', path: '.github/workflows/deploy.yml', state: 'active' }]),
      ),
    };

    await TestBed.configureTestingModule({
      imports: [DeploymentWorkflowEditorComponent],
      providers: [
        { provide: WorkspaceDeploymentsFacade, useValue: facade },
        { provide: WorkspaceDeploymentsService, useValue: service },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(DeploymentWorkflowEditorComponent);
    const component = fixture.componentInstance;
    const emitted: unknown[] = [];

    fixture.componentRef.setInput('clientId', 'c1');
    fixture.componentRef.setInput('agents', [{ id: 'a1', name: 'Prod' }]);
    component.saved.subscribe((dto) => emitted.push(dto));
    component.open.set(true);
    fixture.detectChanges();

    expect(facade.loadConnectionOptions).toHaveBeenCalledWith('c1');

    // GitLab: no provider workflow.
    component.onConnectionChange('k2');
    component.name.set('Deploy');
    component.repository.set('group/api');
    expect(component.needsProviderWorkflow()).toBe(false);
    component.scope.set('environments');
    expect(component.valid()).toBe(false);
    component.agentIds.set(['a1']);
    expect(component.valid()).toBe(true);

    component.onSubmit();
    expect(emitted).toEqual([
      {
        connectionId: 'k2',
        name: 'Deploy',
        description: null,
        repository: 'group/api',
        workflow: null,
        defaultRef: null,
        defaultInputs: {},
        scope: 'environments',
        agentIds: ['a1'],
        agentTriggerEnabled: false,
        enabled: true,
      },
    ]);

    // GitHub: the workflow file is required; picking a repository loads branches and workflows.
    component.onConnectionChange('k1');
    component.onPickRepository(
      { id: 'org/api', name: 'api', fullName: 'org/api', defaultBranch: 'main', url: null, private: true },
      new Event('mousedown'),
    );
    expect(service.listBranches).toHaveBeenCalledWith('c1', 'k1', 'org/api');
    expect(service.listProviderWorkflows).toHaveBeenCalledWith('c1', 'k1', 'org/api');
    expect(component.defaultRef()).toBe('main');
    expect(component.valid()).toBe(false);
    component.providerWorkflow.set('7');
    expect(component.valid()).toBe(true);
  });

  it('sends every content field when an admin saves a workflow an environment proposed (the save approves it)', async () => {
    const facade = {
      connectionOptions$: new BehaviorSubject([
        { id: 'k1', label: 'GitHub', provider: 'github', lastTestStatus: 'ok' },
      ]),
      connectionOptionsLoading$: new BehaviorSubject(false),
      loadConnectionOptions: jest.fn(),
    };
    const service = {
      listRepositories: jest.fn(() => of([])),
      listBranches: jest.fn(() => of([])),
      listProviderWorkflows: jest.fn(() => of([])),
    };

    await TestBed.configureTestingModule({
      imports: [DeploymentWorkflowEditorComponent],
      providers: [
        { provide: WorkspaceDeploymentsFacade, useValue: facade },
        { provide: WorkspaceDeploymentsService, useValue: service },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(DeploymentWorkflowEditorComponent);
    const component = fixture.componentInstance;
    const emitted: unknown[] = [];

    fixture.componentRef.setInput('clientId', 'c1');
    fixture.componentRef.setInput('agents', [{ id: 'a1', name: 'Prod' }]);
    fixture.componentRef.setInput('workflow', {
      id: 'w1',
      clientId: 'c1',
      connectionId: 'k1',
      provider: 'github',
      connectionLabel: 'GitHub',
      name: 'Deploy staging',
      description: 'Proposed by the environment',
      repository: 'org/api',
      workflow: 'deploy.yml',
      defaultRef: 'main',
      defaultInputs: { env: 'staging' },
      scope: 'environments',
      agentIds: ['a1'],
      agentTriggerEnabled: true,
      enabled: true,
      approvalStatus: 'pending',
      approvedAt: null,
      createdBy: 'agent',
      updatedBy: 'agent',
      createdByAgentId: 'a1',
      lastRunStatus: null,
      lastRunConclusion: null,
      lastRunAt: null,
      createdAt: '2026-11-01T10:00:00.000Z',
      updatedAt: '2026-11-01T10:00:00.000Z',
    });
    component.saved.subscribe((dto) => emitted.push(dto));
    component.open.set(true);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="deployment-editor-pending-approval"]')).not.toBeNull();

    component.onSubmit();
    expect(emitted).toEqual([
      {
        connectionId: 'k1',
        name: 'Deploy staging',
        description: 'Proposed by the environment',
        repository: 'org/api',
        workflow: 'deploy.yml',
        defaultRef: 'main',
        defaultInputs: { env: 'staging' },
        scope: 'environments',
        agentIds: ['a1'],
        agentTriggerEnabled: true,
        enabled: true,
      },
    ]);
  });
});
