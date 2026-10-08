import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';

import { loadEnvironmentProgress } from './environment-progress.actions';
import { EnvironmentProgressFacade } from './environment-progress.facade';

describe('EnvironmentProgressFacade', () => {
  let facade: EnvironmentProgressFacade;
  let store: jest.Mocked<Store>;

  beforeEach(() => {
    store = { select: jest.fn().mockReturnValue(of({})), dispatch: jest.fn() } as any;

    TestBed.configureTestingModule({
      providers: [EnvironmentProgressFacade, { provide: Store, useValue: store }],
    });

    facade = TestBed.inject(EnvironmentProgressFacade);
  });

  it('should dispatch loadEnvironmentProgress', () => {
    facade.loadEnvironmentProgress('client-1');

    expect(store.dispatch).toHaveBeenCalledWith(loadEnvironmentProgress({ clientId: 'client-1' }));
  });

  it('should expose selectors via store.select', (done) => {
    store.select.mockReturnValue(of([]));

    facade.getClientEnvironmentProgress$('client-1').subscribe((value) => {
      expect(value).toEqual([]);
      done();
    });
  });

  it('should select per-agent, pending and workspace progress', () => {
    facade.getClientEnvironmentProgressByAgentId$('client-1');
    facade.getClientPendingEnvironmentProgress$('client-1');
    facade.getWorkspaceEnvironmentProgress$('client-1');

    facade.getEnvironmentProgressForAgent$('client-1', 'agent-1');
    facade.getCreateEnvironmentProgress$('client-1', 'New');

    expect(facade.workspaceProgressByClientId$).toBeDefined();
    expect(store.select).toHaveBeenCalledTimes(6);
  });
});
