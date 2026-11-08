import { initialDeploymentConnectionsState } from './deployment-connections.reducer';
import {
  selectDeploymentConnections,
  selectDeploymentConnectionsError,
  selectDeploymentConnectionsHasNext,
  selectDeploymentConnectionsLastTest,
  selectDeploymentConnectionsLoading,
  selectDeploymentConnectionsQuery,
  selectDeploymentConnectionsSaving,
  selectDeploymentConnectionsTestingIds,
} from './deployment-connections.selectors';

describe('deployment connections selectors', () => {
  it('reads the feature slice', () => {
    const slice = {
      ...initialDeploymentConnectionsState,
      hasNext: true,
      loading: true,
      saving: true,
      testingIds: ['k1'],
      query: { search: 'x' },
      error: 'e',
    };
    const state = { deploymentConnections: slice };

    expect(selectDeploymentConnections(state)).toEqual([]);
    expect(selectDeploymentConnectionsHasNext(state)).toBe(true);
    expect(selectDeploymentConnectionsLoading(state)).toBe(true);
    expect(selectDeploymentConnectionsSaving(state)).toBe(true);
    expect(selectDeploymentConnectionsTestingIds(state)).toEqual(['k1']);
    expect(selectDeploymentConnectionsQuery(state)).toEqual({ search: 'x' });
    expect(selectDeploymentConnectionsLastTest(state)).toBeNull();
    expect(selectDeploymentConnectionsError(state)).toBe('e');
  });
});
