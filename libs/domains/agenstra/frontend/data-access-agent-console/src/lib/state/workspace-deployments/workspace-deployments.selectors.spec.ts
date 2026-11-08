import { initialWorkspaceDeploymentsState } from './workspace-deployments.reducer';
import {
  selectCancellingDeploymentRunIds,
  selectDeploymentRuns,
  selectDeploymentRunsTotal,
  selectDeploymentWorkflows,
  selectDeploymentWorkflowsHasNext,
  selectLastTriggeredDeploymentRun,
  selectSelectedDeploymentRun,
  selectSyncingDeploymentWorkflowIds,
  selectWorkspaceDeploymentsClientId,
  selectWorkspaceDeploymentsError,
} from './workspace-deployments.selectors';

describe('workspace deployments selectors', () => {
  it('reads the feature slice', () => {
    const state = {
      workspaceDeployments: {
        ...initialWorkspaceDeploymentsState,
        clientId: 'c1',
        workflowsHasNext: true,
        runsTotal: 3,
        syncingWorkflowIds: ['w1'],
        cancellingRunIds: ['r1'],
        error: 'e',
      },
    };

    expect(selectWorkspaceDeploymentsClientId(state)).toBe('c1');
    expect(selectDeploymentWorkflows(state)).toEqual([]);
    expect(selectDeploymentWorkflowsHasNext(state)).toBe(true);
    expect(selectDeploymentRuns(state)).toEqual([]);
    expect(selectDeploymentRunsTotal(state)).toBe(3);
    expect(selectSelectedDeploymentRun(state)).toBeNull();
    expect(selectLastTriggeredDeploymentRun(state)).toBeNull();
    expect(selectSyncingDeploymentWorkflowIds(state)).toEqual(['w1']);
    expect(selectCancellingDeploymentRunIds(state)).toEqual(['r1']);
    expect(selectWorkspaceDeploymentsError(state)).toBe('e');
  });
});
