import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';

import {
  approveDeploymentWorkflow,
  cancelDeploymentRun,
  clearDeploymentRunLogs,
  clearSelectedDeploymentRun,
  clearSelectedDeploymentWorkflow,
  clearWorkspaceDeploymentsError,
  createDeploymentWorkflow,
  deleteDeploymentWorkflow,
  loadDeploymentConnectionOptions,
  loadDeploymentRun,
  loadDeploymentRunLogs,
  loadDeploymentRuns,
  loadDeploymentWorkflow,
  loadDeploymentWorkflows,
  syncDeploymentWorkflow,
  triggerDeploymentWorkflow,
  updateDeploymentWorkflow,
} from './workspace-deployments.actions';
import { WorkspaceDeploymentsFacade } from './workspace-deployments.facade';

describe('WorkspaceDeploymentsFacade', () => {
  it('dispatches deployment actions', () => {
    const store = { select: jest.fn().mockReturnValue(of(null)), dispatch: jest.fn() };

    TestBed.configureTestingModule({ providers: [WorkspaceDeploymentsFacade, { provide: Store, useValue: store }] });

    const facade = TestBed.inject(WorkspaceDeploymentsFacade);
    const dto = { connectionId: 'k1', name: 'Deploy', repository: 'org/api' };

    facade.loadWorkflows('c1', { agentId: 'a1' });
    facade.openWorkflow('c1', 'w1');
    facade.closeWorkflow();
    facade.createWorkflow('c1', dto);
    facade.updateWorkflow('c1', 'w1', { enabled: false });
    facade.deleteWorkflow('c1', 'w1');
    facade.approveWorkflow('c1', 'w1', 't1');
    facade.trigger('c1', 'w1', { ref: 'main' });
    facade.sync('c1', 'w1');
    facade.loadRuns('c1', { workflowId: 'w1' });
    facade.openRun('c1', 'r1');
    facade.openRun('c1', 'r1', { refresh: true });
    facade.closeRun();
    facade.loadLogs('c1', 'r1');
    facade.clearLogs();
    facade.cancelRun('c1', 'r1');
    facade.loadConnectionOptions('c1');
    facade.clearError();

    expect(store.dispatch.mock.calls.map(([action]) => action)).toEqual([
      loadDeploymentWorkflows({ clientId: 'c1', query: { agentId: 'a1' } }),
      loadDeploymentWorkflow({ clientId: 'c1', workflowId: 'w1' }),
      clearSelectedDeploymentWorkflow(),
      createDeploymentWorkflow({ clientId: 'c1', dto }),
      updateDeploymentWorkflow({ clientId: 'c1', workflowId: 'w1', dto: { enabled: false } }),
      deleteDeploymentWorkflow({ clientId: 'c1', workflowId: 'w1' }),
      approveDeploymentWorkflow({ clientId: 'c1', workflowId: 'w1', updatedAt: 't1' }),
      triggerDeploymentWorkflow({ clientId: 'c1', workflowId: 'w1', dto: { ref: 'main' } }),
      syncDeploymentWorkflow({ clientId: 'c1', workflowId: 'w1' }),
      loadDeploymentRuns({ clientId: 'c1', query: { workflowId: 'w1' } }),
      loadDeploymentRun({ clientId: 'c1', runId: 'r1' }),
      loadDeploymentRun({ clientId: 'c1', runId: 'r1', refresh: true }),
      clearSelectedDeploymentRun(),
      loadDeploymentRunLogs({ clientId: 'c1', runId: 'r1', jobId: null }),
      clearDeploymentRunLogs(),
      cancelDeploymentRun({ clientId: 'c1', runId: 'r1' }),
      loadDeploymentConnectionOptions({ clientId: 'c1' }),
      clearWorkspaceDeploymentsError(),
    ]);
  });
});
