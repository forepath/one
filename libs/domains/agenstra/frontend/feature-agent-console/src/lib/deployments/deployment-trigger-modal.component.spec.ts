import { TestBed } from '@angular/core/testing';
import { WorkspaceDeploymentsService } from '@forepath/agenstra/frontend/data-access-agent-console';
import type { DeploymentWorkflowSummary } from '@forepath/agenstra/shared/util-opencode-config';
import { of } from 'rxjs';

import { DeploymentTriggerModalComponent } from './deployment-trigger-modal.component';

const workflow: DeploymentWorkflowSummary = {
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
  defaultInputs: { env: 'prod' },
  scope: 'environments',
  agentIds: ['a1'],
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
};

describe('DeploymentTriggerModalComponent', () => {
  async function create(canManage: boolean) {
    const service = {
      listBranches: jest.fn(() =>
        of([
          { name: 'main', sha: null, default: true },
          { name: 'release', sha: null, default: false },
        ]),
      ),
    };

    await TestBed.configureTestingModule({
      imports: [DeploymentTriggerModalComponent],
      providers: [{ provide: WorkspaceDeploymentsService, useValue: service }],
    }).compileComponents();

    const fixture = TestBed.createComponent(DeploymentTriggerModalComponent);

    fixture.componentRef.setInput('clientId', 'c1');
    fixture.componentRef.setInput('workflow', workflow);
    fixture.componentRef.setInput('canManage', canManage);
    fixture.componentRef.setInput('agents', [
      { id: 'a1', name: 'Prod' },
      { id: 'a2', name: 'Staging' },
    ]);
    fixture.componentInstance.open.set(true);
    fixture.detectChanges();

    return { fixture, component: fixture.componentInstance, service };
  }

  afterEach(() => TestBed.resetTestingModule());

  it('prefills the default inputs, offers only assigned environments and emits the trigger', async () => {
    const { component, service } = await create(false);
    const emitted: unknown[] = [];

    component.triggered.subscribe((dto) => emitted.push(dto));

    expect(service.listBranches).not.toHaveBeenCalled();
    expect(component.inputs()).toEqual({ env: 'prod' });
    expect(component.environmentOptions().map((agent) => agent.id)).toEqual(['a1']);

    component.ref.set(' release ');
    component.agentId.set('a1');
    component.inputs.set({ env: 'staging', dryRun: 'true' });
    component.onSubmit();

    expect(emitted).toEqual([{ ref: 'release', inputs: { env: 'staging', dryRun: 'true' }, agentId: 'a1' }]);
  });

  it('suggests branches for workspace admins', async () => {
    const { component, service } = await create(true);

    expect(service.listBranches).toHaveBeenCalledWith('c1', 'k1', 'org/api');
    component.ref.set('rel');
    expect(component.branchSuggestions().map((branch) => branch.name)).toEqual(['release']);
  });
});
