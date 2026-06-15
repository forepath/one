import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { BehaviorSubject, of } from 'rxjs';

import {
  connectTicketsBoardSocket,
  disconnectTicketsBoardSocket,
  setTicketsBoardSocketClient,
} from './tickets-board-socket.actions';
import { getTicketsBoardSocketInstance } from './tickets-board-socket.effects';
import { TicketsBoardSocketFacade } from './tickets-board-socket.facade';
import { selectTicketsBoardSocketConnected, selectTicketsBoardSocketState } from './tickets-board-socket.selectors';

jest.mock('./tickets-board-socket.effects', () => ({
  getTicketsBoardSocketInstance: jest.fn(),
}));

describe('TicketsBoardSocketFacade', () => {
  let facade: TicketsBoardSocketFacade;
  let store: { dispatch: jest.Mock; select: jest.Mock };
  let mockSocket: { connected: boolean; emit: jest.Mock };

  beforeEach(() => {
    mockSocket = {
      connected: true,
      emit: jest.fn(),
    };
    (getTicketsBoardSocketInstance as jest.Mock).mockReturnValue(mockSocket);

    store = {
      dispatch: jest.fn(),
      select: jest.fn().mockImplementation((selector: unknown) => {
        if (selector === selectTicketsBoardSocketState) {
          return of({
            selectedClientId: null,
            settingClient: false,
            settingClientId: null,
          });
        }

        if (selector === selectTicketsBoardSocketConnected) {
          return of(true);
        }

        return of(null);
      }),
    };

    TestBed.configureTestingModule({
      providers: [TicketsBoardSocketFacade, { provide: Store, useValue: store }],
    });

    facade = TestBed.inject(TicketsBoardSocketFacade);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('connect dispatches connectTicketsBoardSocket', () => {
    facade.connect();
    expect(store.dispatch).toHaveBeenCalledWith(connectTicketsBoardSocket());
  });

  it('disconnect dispatches disconnectTicketsBoardSocket', () => {
    facade.disconnect();
    expect(store.dispatch).toHaveBeenCalledWith(disconnectTicketsBoardSocket());
  });

  it('setClient dispatches and emits when socket is connected', () => {
    facade.setClient('workspace-1');
    expect(store.dispatch).toHaveBeenCalledWith(setTicketsBoardSocketClient({ clientId: 'workspace-1' }));
    expect(mockSocket.emit).toHaveBeenCalledWith('setClient', { clientId: 'workspace-1' });
  });

  it('setClient skips when already selected for same client', () => {
    store.select = jest.fn().mockImplementation((selector: unknown) => {
      if (selector === selectTicketsBoardSocketState) {
        return of({
          selectedClientId: 'same',
          settingClient: false,
          settingClientId: null,
        });
      }

      if (selector === selectTicketsBoardSocketConnected) {
        return of(true);
      }

      return of(null);
    });
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [TicketsBoardSocketFacade, { provide: Store, useValue: store }],
    });
    TestBed.inject(TicketsBoardSocketFacade).setClient('same');
    expect(store.dispatch).not.toHaveBeenCalled();
    expect(mockSocket.emit).not.toHaveBeenCalled();
  });

  it('setClient skips when already setting the same client id', () => {
    store.select = jest.fn().mockImplementation((selector: unknown) => {
      if (selector === selectTicketsBoardSocketState) {
        return of({
          selectedClientId: null,
          settingClient: true,
          settingClientId: 'pending',
        });
      }

      if (selector === selectTicketsBoardSocketConnected) {
        return of(true);
      }

      return of(null);
    });
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [TicketsBoardSocketFacade, { provide: Store, useValue: store }],
    });
    TestBed.inject(TicketsBoardSocketFacade).setClient('pending');
    expect(store.dispatch).not.toHaveBeenCalled();
  });

  it('ensureConnectedAndSetClient dispatches connect when initially disconnected', (done) => {
    const connected$ = new BehaviorSubject(false);

    store.select = jest.fn().mockImplementation((selector: unknown) => {
      if (selector === selectTicketsBoardSocketConnected) {
        return connected$.asObservable();
      }

      if (selector === selectTicketsBoardSocketState) {
        return of({
          selectedClientId: null,
          settingClient: false,
          settingClientId: null,
        });
      }

      return of(null);
    });
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [TicketsBoardSocketFacade, { provide: Store, useValue: store }],
    });
    const f = TestBed.inject(TicketsBoardSocketFacade);

    f.ensureConnectedAndSetClient('c1').subscribe(() => {
      expect(store.dispatch).toHaveBeenCalledWith(connectTicketsBoardSocket());
      expect(mockSocket.emit).toHaveBeenCalledWith('setClient', { clientId: 'c1' });
      done();
    });
    queueMicrotask(() => connected$.next(true));
  });
});
