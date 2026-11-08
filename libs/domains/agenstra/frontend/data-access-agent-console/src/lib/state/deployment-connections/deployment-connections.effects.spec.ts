import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import type { Action } from '@ngrx/store';
import { provideMockStore } from '@ngrx/store/testing';
import { Observable, of, throwError } from 'rxjs';
import { take } from 'rxjs/operators';

import { DeploymentConnectionsService } from '../../services/deployment-connections.service';

import {
  createDeploymentConnection,
  createDeploymentConnectionSuccess,
  deleteDeploymentConnection,
  deleteDeploymentConnectionSuccess,
  loadDeploymentConnections,
  loadDeploymentConnectionsSuccess,
  saveDeploymentConnectionFailure,
  testDeploymentConnection,
  testDeploymentConnectionSuccess,
} from './deployment-connections.actions';
import {
  createDeploymentConnection$,
  deleteDeploymentConnection$,
  loadDeploymentConnections$,
  reloadDeploymentConnectionsAfterWrite$,
  testDeploymentConnection$,
} from './deployment-connections.effects';
import { initialDeploymentConnectionsState } from './deployment-connections.reducer';

describe('deployment connections effects', () => {
  let actions$: Observable<Action>;
  let service: jest.Mocked<Pick<DeploymentConnectionsService, 'list' | 'create' | 'delete' | 'test'>>;

  beforeEach(() => {
    service = { list: jest.fn(), create: jest.fn(), delete: jest.fn(), test: jest.fn() };
    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() => actions$),
        provideMockStore({
          initialState: { deploymentConnections: { ...initialDeploymentConnectionsState, query: { search: 'x' } } },
        }),
        { provide: DeploymentConnectionsService, useValue: service },
      ],
    });
  });

  const first = (effect: () => Observable<Action>): Promise<Action> =>
    new Promise((resolve) => TestBed.runInInjectionContext(() => effect().pipe(take(1)).subscribe(resolve)));

  it('loads a page with the default limit and derives hasNext', async () => {
    service.list.mockReturnValue(of(Array.from({ length: 10 }, (_, i) => ({ id: `k${i}` }) as never)));
    actions$ = of(loadDeploymentConnections({ query: {} }));

    const action = (await first(loadDeploymentConnections$)) as ReturnType<typeof loadDeploymentConnectionsSuccess>;

    expect(service.list).toHaveBeenCalledWith({ limit: 10 });
    expect(action.hasNext).toBe(true);
  });

  it('creates a connection', async () => {
    service.create.mockReturnValue(of({ id: 'k1' } as never));
    actions$ = of(createDeploymentConnection({ dto: { label: 'x', provider: 'jenkins' } }));

    await expect(first(createDeploymentConnection$)).resolves.toEqual(
      createDeploymentConnectionSuccess({ connection: { id: 'k1' } as never }),
    );
  });

  it('surfaces the 409 message of a refused delete', async () => {
    service.delete.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({ status: 409, error: { message: 'Connection is used by 2 deployment workflows' } }),
      ),
    );
    actions$ = of(deleteDeploymentConnection({ id: 'k1' }));

    await expect(first(deleteDeploymentConnection$)).resolves.toEqual(
      saveDeploymentConnectionFailure({ error: 'Connection is used by 2 deployment workflows' }),
    );
  });

  it('reloads the listed page after create / delete', async () => {
    actions$ = of(deleteDeploymentConnectionSuccess({ id: 'k1' }));

    await expect(first(reloadDeploymentConnectionsAfterWrite$)).resolves.toEqual(
      loadDeploymentConnections({ query: { search: 'x' } }),
    );
  });

  it('tests a connection', async () => {
    service.test.mockReturnValue(of({ ok: true, testedAt: 't' }));
    actions$ = of(testDeploymentConnection({ id: 'k1' }));

    await expect(first(testDeploymentConnection$)).resolves.toEqual(
      testDeploymentConnectionSuccess({ id: 'k1', result: { ok: true, testedAt: 't' } }),
    );
  });
});
