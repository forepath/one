import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';

import {
  clearDeploymentConnectionsError,
  clearDeploymentConnectionTestResult,
  createDeploymentConnection,
  deleteDeploymentConnection,
  loadDeploymentConnections,
  testDeploymentConnection,
  updateDeploymentConnection,
} from './deployment-connections.actions';
import { DeploymentConnectionsFacade } from './deployment-connections.facade';

describe('DeploymentConnectionsFacade', () => {
  it('dispatches connection actions', () => {
    const store = { select: jest.fn().mockReturnValue(of(null)), dispatch: jest.fn() };

    TestBed.configureTestingModule({ providers: [DeploymentConnectionsFacade, { provide: Store, useValue: store }] });

    const facade = TestBed.inject(DeploymentConnectionsFacade);
    const dto = { label: 'GitLab', provider: 'gitlab' as const, token: 'secret' };

    facade.load({ limit: 10 });
    facade.create(dto);
    facade.update('k1', { label: 'x' });
    facade.delete('k1');
    facade.test('k1');
    facade.clearError();
    facade.clearTestResult();

    expect(store.dispatch.mock.calls.map(([action]) => action)).toEqual([
      loadDeploymentConnections({ query: { limit: 10 } }),
      createDeploymentConnection({ dto }),
      updateDeploymentConnection({ id: 'k1', dto: { label: 'x' } }),
      deleteDeploymentConnection({ id: 'k1' }),
      testDeploymentConnection({ id: 'k1' }),
      clearDeploymentConnectionsError(),
      clearDeploymentConnectionTestResult(),
    ]);
  });
});
