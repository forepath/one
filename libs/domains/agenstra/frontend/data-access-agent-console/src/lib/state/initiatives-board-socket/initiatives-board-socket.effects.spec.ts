import { Subject } from 'rxjs';
import { io, Socket } from 'socket.io-client';

import {
  initiativeArtifactLiveRemoved,
  initiativeLiveUpsert,
  initiativeRunTurnLiveAppended,
  initiativeWorkItemsLiveChanged,
} from '../initiatives/initiatives.actions';
import type { InitiativeDto } from '../initiatives/initiatives.types';

import {
  connectInitiativesBoardSocket,
  connectInitiativesBoardSocketSuccess,
  disconnectInitiativesBoardSocket,
} from './initiatives-board-socket.actions';
import {
  connectInitiativesBoardSocket$,
  disconnectInitiativesBoardSocket$,
  getInitiativesBoardSocketInstance,
  resolveInitiativesBoardWebsocketUrl,
  restoreInitiativesBoardSocketClient$,
} from './initiatives-board-socket.effects';

jest.mock('socket.io-client', () => ({
  io: jest.fn(),
}));

const environment = {
  console: {
    urls: {
      restApi: 'http://localhost:3100/api',
      websocket: 'http://localhost:3100/socket/clients',
    },
  },
  authentication: { config: { type: 'api-key', apiKey: 'x' } },
} as never;

describe('resolveInitiativesBoardWebsocketUrl', () => {
  it('derives /initiatives from the /clients websocket URL', () => {
    expect(resolveInitiativesBoardWebsocketUrl(environment)).toBe('http://localhost:3100/socket/initiatives');
  });
});

describe('InitiativesBoardSocketEffects', () => {
  let actions$: Subject<ReturnType<typeof connectInitiativesBoardSocket>>;
  let mockSocket: jest.Mocked<Partial<Socket>>;
  const listeners = new Map<string, (payload?: unknown) => void>();

  beforeEach(() => {
    listeners.clear();
    actions$ = new Subject();
    mockSocket = {
      connected: true,
      on: jest.fn((event: string, cb: (payload?: unknown) => void) => {
        listeners.set(event, cb);

        return mockSocket as unknown as Socket;
      }),
      off: jest.fn(),
      emit: jest.fn(),
      disconnect: jest.fn(),
    };

    (io as jest.Mock).mockReturnValue(mockSocket as unknown as Socket);
  });

  function connect(received: unknown[]) {
    const sub = connectInitiativesBoardSocket$(actions$ as never, environment, null).subscribe((action) =>
      received.push(action),
    );

    actions$.next(connectInitiativesBoardSocket());

    return sub;
  }

  it('disconnect effect disconnects the active socket', (done) => {
    const d = new Subject<ReturnType<typeof disconnectInitiativesBoardSocket>>();

    connect([]);
    disconnectInitiativesBoardSocket$(d as never).subscribe(() => {
      expect(mockSocket.disconnect).toHaveBeenCalled();
      done();
    });
    d.next(disconnectInitiativesBoardSocket());
    d.complete();
  });

  it('maps live board events to ngrx actions', (done) => {
    const received: unknown[] = [];
    const sub = connect(received);
    const initiative = { id: 'ini-1', clientId: 'client-1', version: 2 } as InitiativeDto;
    const workItems = { initiativeId: 'ini-1', items: [], initiativeVersion: 3, unknowns: [] };

    listeners.get('initiativeUpsert')?.(initiative);
    listeners.get('initiativeArtifactRemoved')?.({ id: 'art-1', initiativeId: 'ini-1' });
    listeners.get('initiativeWorkItemsChanged')?.({ initiativeId: 'ini-1', ...workItems });
    listeners.get('initiativeRunTurnAppended')?.({ id: 'turn-1', runId: 'run-1', initiativeId: 'ini-1', seq: 1 });

    setTimeout(() => {
      expect(received).toContainEqual(initiativeLiveUpsert({ initiative }));
      expect(received).toContainEqual(initiativeArtifactLiveRemoved({ id: 'art-1', initiativeId: 'ini-1' }));
      expect(received).toContainEqual(initiativeWorkItemsLiveChanged({ initiativeId: 'ini-1', workItems }));
      expect(received).toContainEqual(
        initiativeRunTurnLiveAppended({
          initiativeId: 'ini-1',
          turn: { id: 'turn-1', runId: 'run-1', seq: 1 } as never,
        }),
      );
      sub.unsubscribe();
      done();
    }, 0);
  });

  it('drops malformed payloads instead of dispatching them', (done) => {
    const received: unknown[] = [];
    const sub = connect(received);

    listeners.get('initiativeUpsert')?.(null);
    listeners.get('initiativeRunUpsert')?.({ status: 'running' });
    listeners.get('initiativeWorkItemsChanged')?.({ initiativeId: 'ini-1' });
    listeners.get('initiativeWorkItemsChanged')?.({ items: [] });

    setTimeout(() => {
      expect(received.filter((action) => String((action as { type: string }).type).includes('Live'))).toEqual([]);
      sub.unsubscribe();
      done();
    }, 0);
  });

  it('restore effect emits setClient when a client is selected', (done) => {
    const selected$ = new Subject<string | null>();
    const setting$ = new Subject<boolean>();
    const fakeStore = {
      select: jest.fn().mockImplementation(() => (fakeStore.select.mock.calls.length === 1 ? selected$ : setting$)),
    };
    const action$ = new Subject<ReturnType<typeof connectInitiativesBoardSocketSuccess>>();

    connect([]);
    restoreInitiativesBoardSocketClient$(action$ as never, fakeStore as never).subscribe();
    selected$.next('client-42');
    setting$.next(false);
    action$.next(connectInitiativesBoardSocketSuccess());

    setTimeout(() => {
      expect(getInitiativesBoardSocketInstance()).not.toBeNull();
      expect(mockSocket.emit).toHaveBeenCalledWith('setClient', { clientId: 'client-42' });
      done();
    }, 150);
  });
});
