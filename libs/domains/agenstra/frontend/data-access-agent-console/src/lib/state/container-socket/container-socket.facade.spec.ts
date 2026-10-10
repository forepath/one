import { DestroyRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';

import { connectSocket, disconnectSocket, setChatModel, setClient } from './container-socket.actions';
import { getSocketInstance } from './container-socket.effects';
import { ContainerSocketFacade } from './container-socket.facade';
import { initialContainerSocketState } from './container-socket.reducer';

jest.mock('./container-socket.effects', () => ({
  getSocketInstance: jest.fn(),
}));

describe('ContainerSocketFacade', () => {
  let facade: ContainerSocketFacade;
  let store: MockStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        ContainerSocketFacade,
        provideMockStore({
          initialState: { containerSocket: initialContainerSocketState },
        }),
        { provide: DestroyRef, useValue: { onDestroy: jest.fn() } },
      ],
    });

    facade = TestBed.inject(ContainerSocketFacade);
    store = TestBed.inject(MockStore);
    jest.spyOn(store, 'dispatch');
  });

  it('should dispatch connect', () => {
    facade.connect();
    expect(store.dispatch).toHaveBeenCalledWith(connectSocket());
  });

  it('should dispatch disconnect', () => {
    facade.disconnect();
    expect(store.dispatch).toHaveBeenCalledWith(disconnectSocket());
  });

  it('should dispatch setChatModel', () => {
    facade.setChatModel('gpt');
    expect(store.dispatch).toHaveBeenCalledWith(setChatModel({ model: 'gpt' }));
  });

  it('should emit setClient when connected', () => {
    const emit = jest.fn();
    (getSocketInstance as jest.Mock).mockReturnValue({ connected: true, emit });
    store.setState({
      containerSocket: { ...initialContainerSocketState, connected: true, selectedClientId: null },
    });

    facade.setClient('c1');

    expect(store.dispatch).toHaveBeenCalledWith(setClient({ clientId: 'c1' }));
    expect(emit).toHaveBeenCalledWith('setClient', { clientId: 'c1' });
  });

  describe('refineChatPlan', () => {
    it('should emit refineChatPlan without contextInjection when none is given', () => {
      const emit = jest.fn();
      (getSocketInstance as jest.Mock).mockReturnValue({ connected: true, emit });

      facade.refineChatPlan('a1', 'p1', 'tweak', 'corr-1');

      expect(emit).toHaveBeenCalledWith('refineChatPlan', {
        agentId: 'a1',
        planId: 'p1',
        message: 'tweak',
        correlationId: 'corr-1',
      });
    });

    it('should include contextInjection when given', () => {
      const emit = jest.fn();
      (getSocketInstance as jest.Mock).mockReturnValue({ connected: true, emit });
      const contextInjection = { includeWorkspace: true, environmentIds: ['a1'], ticketShas: ['abc'] };

      facade.refineChatPlan('a1', 'p1', 'tweak', 'corr-2', contextInjection);

      expect(emit).toHaveBeenCalledWith('refineChatPlan', {
        agentId: 'a1',
        planId: 'p1',
        message: 'tweak',
        correlationId: 'corr-2',
        contextInjection,
      });
    });

    it('should not emit when the socket is disconnected', () => {
      const emit = jest.fn();
      (getSocketInstance as jest.Mock).mockReturnValue({ connected: false, emit });
      jest.spyOn(console, 'warn').mockImplementation(() => undefined);

      facade.refineChatPlan('a1', 'p1', 'tweak', 'corr-3');

      expect(emit).not.toHaveBeenCalled();
    });
  });
});
