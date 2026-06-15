import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';

import {
  clearClientAgentAutonomy,
  clearClientAgentAutonomyError,
  loadClientAgentAutonomy,
  upsertClientAgentAutonomy,
} from './client-agent-autonomy.actions';
import { ClientAgentAutonomyFacade } from './client-agent-autonomy.facade';

describe('ClientAgentAutonomyFacade', () => {
  let facade: ClientAgentAutonomyFacade;
  let store: jest.Mocked<Store>;

  beforeEach(() => {
    store = {
      select: jest.fn().mockReturnValue(of(null)),
      dispatch: jest.fn(),
    } as unknown as jest.Mocked<Store>;

    TestBed.configureTestingModule({
      providers: [ClientAgentAutonomyFacade, { provide: Store, useValue: store }],
    });

    facade = TestBed.inject(ClientAgentAutonomyFacade);
  });

  it('dispatches load', () => {
    facade.load('c1', 'a1');
    expect(store.dispatch).toHaveBeenCalledWith(loadClientAgentAutonomy({ clientId: 'c1', agentId: 'a1' }));
  });

  it('dispatches upsert', () => {
    const dto = {
      enabled: true,
      preImproveTicket: false,
      maxRuntimeMs: 3_600_000,
      maxIterations: 20,
    };

    facade.upsert('c1', 'a1', dto);
    expect(store.dispatch).toHaveBeenCalledWith(upsertClientAgentAutonomy({ clientId: 'c1', agentId: 'a1', dto }));
  });

  it('dispatches clear and clearError', () => {
    facade.clearError();
    expect(store.dispatch).toHaveBeenCalledWith(clearClientAgentAutonomyError());
    facade.clear();
    expect(store.dispatch).toHaveBeenCalledWith(clearClientAgentAutonomy());
  });
});
