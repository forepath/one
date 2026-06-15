import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { Store } from '@ngrx/store';
import { provideMockStore } from '@ngrx/store/testing';
import { KeycloakService } from 'keycloak-angular';
import { Subject } from 'rxjs';
import { io, Socket } from 'socket.io-client';

import { ticketBoardTicketUpsert } from '../tickets/tickets.actions';

import {
  connectTicketsBoardSocket,
  connectTicketsBoardSocketFailure,
  connectTicketsBoardSocketSuccess,
  disconnectTicketsBoardSocket,
  disconnectTicketsBoardSocketSuccess,
} from './tickets-board-socket.actions';
import { TICKETS_BOARD_SOCKET_EVENTS } from './tickets-board-socket.constants';
import {
  connectTicketsBoardSocket$,
  disconnectTicketsBoardSocket$,
  resolveTicketsBoardWebsocketUrl,
  restoreTicketsBoardSocketClient$,
} from './tickets-board-socket.effects';
import { initialTicketsBoardSocketState } from './tickets-board-socket.reducer';

jest.mock('socket.io-client', () => ({
  io: jest.fn(),
}));

jest.mock('keycloak-angular', () => ({
  KeycloakService: jest.fn(),
}));

describe('resolveTicketsBoardWebsocketUrl', () => {
  const mockEnvironment = {
    controller: {
      websocketUrl: 'http://localhost:8081/clients',
    },
    authentication: {
      type: 'api-key',
      apiKey: 'test-api-key',
    },
  };

  it('derives /tickets from /clients websocket URL', () => {
    const url = resolveTicketsBoardWebsocketUrl(mockEnvironment as never);

    expect(url).toBe('http://localhost:8081/tickets');
  });

  it('uses explicit ticketsWebsocketUrl when set', () => {
    const url = resolveTicketsBoardWebsocketUrl({
      ...mockEnvironment,
      controller: { ...mockEnvironment.controller, ticketsWebsocketUrl: 'http://example/ws' },
    } as never);

    expect(url).toBe('http://example/ws');
  });

  it('derives /tickets from host when websocket path is not /clients', () => {
    const url = resolveTicketsBoardWebsocketUrl({
      ...mockEnvironment,
      controller: { websocketUrl: 'http://localhost:8081/custom-ns' },
    } as never);

    expect(url).toBe('http://localhost:8081/tickets');
  });

  it('returns null when websocketUrl is missing or blank', () => {
    expect(
      resolveTicketsBoardWebsocketUrl({
        ...mockEnvironment,
        controller: { websocketUrl: '   ' },
      } as never),
    ).toBeNull();
  });
});

describe('TicketsBoardSocketEffects', () => {
  let actions$: Subject<ReturnType<typeof connectTicketsBoardSocket>>;
  let mockSocket: jest.Mocked<Partial<Socket>>;
  let mockEnvironment: {
    controller: { websocketUrl: string; ticketsWebsocketUrl?: string };
    authentication: { type: string; apiKey?: string };
  };
  let mockKeycloakService: jest.Mocked<Partial<KeycloakService>>;

  beforeEach(() => {
    actions$ = new Subject();
    mockSocket = {
      connected: true,
      emit: jest.fn(),
      on: jest.fn(),
      once: jest.fn(),
      off: jest.fn(),
      disconnect: jest.fn(),
    };

    (io as jest.Mock).mockReturnValue(mockSocket as Socket);

    mockEnvironment = {
      controller: {
        websocketUrl: 'http://localhost:8081/clients',
      },
      authentication: {
        type: 'api-key',
        apiKey: 'test-api-key',
      },
    };

    mockKeycloakService = {
      getToken: jest.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() => actions$),
        provideMockStore({
          initialState: {
            ticketsBoardSocket: {
              ...initialTicketsBoardSocketState,
              selectedClientId: 'workspace-1',
              settingClient: false,
            },
          },
        }),
        { provide: ENVIRONMENT, useValue: mockEnvironment },
        { provide: KeycloakService, useValue: mockKeycloakService },
      ],
    });

    TestBed.inject(Actions);
  });

  afterEach(() => {
    const d = new Subject<ReturnType<typeof disconnectTicketsBoardSocket>>();

    disconnectTicketsBoardSocket$(d as never).subscribe();
    d.next(disconnectTicketsBoardSocket());
    d.complete();
    jest.clearAllMocks();
  });

  describe('connectTicketsBoardSocket$', () => {
    it('should return connectTicketsBoardSocketFailure when URL cannot be resolved', (done) => {
      const env = { ...mockEnvironment, controller: { websocketUrl: '' } };

      connectTicketsBoardSocket$(actions$ as never, env as never, null).subscribe((result) => {
        expect(result).toEqual(connectTicketsBoardSocketFailure({ error: 'Tickets WebSocket URL not configured' }));
        done();
      });
      actions$.next(connectTicketsBoardSocket());
    });

    it('should create socket connection with API key authentication', (done) => {
      (mockSocket.on as jest.Mock).mockImplementation((event: string, handler: () => void) => {
        if (event === 'connect') {
          setTimeout(() => handler(), 0);
        }

        return mockSocket as Socket;
      });

      connectTicketsBoardSocket$(actions$ as never, TestBed.inject(ENVIRONMENT), null).subscribe((result) => {
        expect(io).toHaveBeenCalledWith('http://localhost:8081/tickets', {
          transports: ['websocket'],
          rejectUnauthorized: false,
          reconnection: true,
          reconnectionAttempts: 5,
          reconnectionDelay: 1000,
          reconnectionDelayMax: 5000,
          randomizationFactor: 0.5,
          auth: { Authorization: 'Bearer test-api-key' },
        });
        expect(result).toEqual(connectTicketsBoardSocketSuccess());
        done();
      });
      actions$.next(connectTicketsBoardSocket());
    });
  });

  describe('disconnectTicketsBoardSocket$', () => {
    it('should emit disconnect success', (done) => {
      disconnectTicketsBoardSocket$(actions$ as never).subscribe((result) => {
        expect(result).toEqual(disconnectTicketsBoardSocketSuccess());
        done();
      });
      actions$.next(disconnectTicketsBoardSocket());
    });

    it('should disconnect underlying socket when connect had run', (done) => {
      const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};

      (mockSocket.on as jest.Mock).mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
        (listeners[event] ??= []).push(handler);

        return mockSocket as Socket;
      });

      connectTicketsBoardSocket$(actions$ as never, TestBed.inject(ENVIRONMENT), null).subscribe();
      actions$.next(connectTicketsBoardSocket());
      listeners['connect']?.[0]?.();

      disconnectTicketsBoardSocket$(actions$ as never).subscribe(() => {
        expect(mockSocket.disconnect).toHaveBeenCalled();
        done();
      });
      actions$.next(disconnectTicketsBoardSocket());
    });
  });

  describe('server ticketUpsert event', () => {
    it('maps to ticketBoardTicketUpsert', (done) => {
      const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};

      (mockSocket.on as jest.Mock).mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
        (listeners[event] ??= []).push(handler);

        return mockSocket as Socket;
      });

      const out: unknown[] = [];

      connectTicketsBoardSocket$(actions$ as never, TestBed.inject(ENVIRONMENT), null).subscribe((a) => out.push(a));
      actions$.next(connectTicketsBoardSocket());
      listeners['connect']?.[0]?.();

      const ticket = { id: 't1', clientId: 'c1', title: 'Hi' };

      listeners[TICKETS_BOARD_SOCKET_EVENTS.ticketUpsert]?.[0]?.(ticket);

      const match = out.find(
        (a) =>
          typeof a === 'object' &&
          a !== null &&
          'type' in a &&
          (a as { type: string }).type === ticketBoardTicketUpsert.type,
      ) as ReturnType<typeof ticketBoardTicketUpsert> | undefined;

      expect(match?.ticket).toEqual(ticket);
      done();
    });
  });

  describe('restoreTicketsBoardSocketClient$', () => {
    it('re-emits setClient after reconnect when a workspace was selected', fakeAsync(() => {
      (mockSocket.on as jest.Mock).mockImplementation((event: string, handler: () => void) => {
        if (event === 'connect') {
          setTimeout(() => handler(), 0);
        }

        return mockSocket as Socket;
      });

      connectTicketsBoardSocket$(actions$ as never, TestBed.inject(ENVIRONMENT), null).subscribe();
      actions$.next(connectTicketsBoardSocket());
      tick();

      restoreTicketsBoardSocketClient$(actions$ as never, TestBed.inject(Store) as never).subscribe();
      actions$.next(connectTicketsBoardSocketSuccess());
      tick(100);

      expect(mockSocket.emit).toHaveBeenCalledWith('setClient', { clientId: 'workspace-1' });
    }));
  });
});
