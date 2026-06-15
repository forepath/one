import { Subject } from 'rxjs';
import { io, Socket } from 'socket.io-client';

import { loadKnowledgeRelations, loadKnowledgeTree } from '../knowledge/knowledge.actions';

import {
  connectKnowledgeBoardSocket,
  connectKnowledgeBoardSocketSuccess,
  disconnectKnowledgeBoardSocket,
} from './knowledge-board-socket.actions';
import {
  connectKnowledgeBoardSocket$,
  disconnectKnowledgeBoardSocket$,
  getKnowledgeBoardSocketInstance,
  resolveKnowledgeBoardWebsocketUrl,
  restoreKnowledgeBoardSocketClient$,
} from './knowledge-board-socket.effects';

jest.mock('socket.io-client', () => ({
  io: jest.fn(),
}));
jest.mock('keycloak-angular', () => ({
  KeycloakService: jest.fn(),
}));

describe('resolveKnowledgeBoardWebsocketUrl', () => {
  it('derives /pages from /clients websocket URL', () => {
    const url = resolveKnowledgeBoardWebsocketUrl({
      controller: { websocketUrl: 'http://localhost:8081/clients' },
      authentication: { type: 'api-key', apiKey: 'x' },
    } as never);

    expect(url).toBe('http://localhost:8081/pages');
  });
});

describe('KnowledgeBoardSocketEffects', () => {
  let actions$: Subject<ReturnType<typeof connectKnowledgeBoardSocket>>;
  let mockSocket: jest.Mocked<Partial<Socket>>;
  const listeners = new Map<string, (payload?: unknown) => void>();

  beforeEach(() => {
    listeners.clear();
    actions$ = new Subject();
    mockSocket = {
      connected: true,
      on: jest.fn((event: string, cb: (payload?: unknown) => void) => {
        listeners.set(event, cb);

        return mockSocket as Socket;
      }),
      off: jest.fn(),
      emit: jest.fn(),
      disconnect: jest.fn(),
    };

    (io as jest.Mock).mockReturnValue(mockSocket as Socket);
  });

  it('disconnect effect disconnects active socket', (done) => {
    const d = new Subject<ReturnType<typeof disconnectKnowledgeBoardSocket>>();

    connectKnowledgeBoardSocket$(
      actions$ as never,
      {
        controller: { websocketUrl: 'http://localhost:8081/clients' },
        authentication: { type: 'api-key', apiKey: 'x' },
      } as never,
      null,
    ).subscribe();
    actions$.next(connectKnowledgeBoardSocket());
    disconnectKnowledgeBoardSocket$(d as never).subscribe(() => {
      expect(mockSocket.disconnect).toHaveBeenCalled();
      done();
    });
    d.next(disconnectKnowledgeBoardSocket());
    d.complete();
  });

  it('maps tree and relation socket events to ngrx actions', (done) => {
    const received: unknown[] = [];
    const sub = connectKnowledgeBoardSocket$(
      actions$ as never,
      {
        controller: { websocketUrl: 'http://localhost:8081/clients' },
        authentication: { type: 'api-key', apiKey: 'x' },
      } as never,
      null,
    ).subscribe((action) => {
      received.push(action);
    });

    actions$.next(connectKnowledgeBoardSocket());
    listeners.get('knowledgeTreeChanged')?.({ clientId: 'client-1' });
    listeners.get('knowledgeRelationChanged')?.({ clientId: 'client-1', sourceType: 'page', sourceId: 'page-1' });

    setTimeout(() => {
      expect(received).toContainEqual(loadKnowledgeTree({ clientId: 'client-1' }));
      expect(received).toContainEqual(
        loadKnowledgeRelations({
          clientId: 'client-1',
          sourceType: 'page',
          sourceId: 'page-1',
        }),
      );
      sub.unsubscribe();
      done();
    }, 0);
  });

  it('ignores invalid page activity payload action types', (done) => {
    const received: unknown[] = [];
    const sub = connectKnowledgeBoardSocket$(
      actions$ as never,
      {
        controller: { websocketUrl: 'http://localhost:8081/clients' },
        authentication: { type: 'api-key', apiKey: 'x' },
      } as never,
      null,
    ).subscribe((action) => received.push(action));

    actions$.next(connectKnowledgeBoardSocket());
    listeners.get('knowledgePageActivityCreated')?.({
      id: 'a1',
      pageId: 'p1',
      occurredAt: '2024-01-01T00:00:00Z',
      actorType: 'human',
      actionType: 'NOT_A_REAL_ACTION',
      payload: {},
    });

    setTimeout(() => {
      expect(received).not.toContainEqual(expect.objectContaining({ type: '[Knowledge] Prepend Knowledge Activity' }));
      sub.unsubscribe();
      done();
    }, 0);
  });

  it('restore effect emits setClient when selected client exists', (done) => {
    const selected$ = new Subject<string | null>();
    const setting$ = new Subject<boolean>();
    const fakeStore = {
      select: jest.fn().mockImplementation((selector: unknown) => {
        if (selector) {
          return fakeStore.select.mock.calls.length === 1 ? selected$ : setting$;
        }

        return setting$;
      }),
    };
    const action$ = new Subject<ReturnType<typeof connectKnowledgeBoardSocketSuccess>>();

    connectKnowledgeBoardSocket$(
      actions$ as never,
      {
        controller: { websocketUrl: 'http://localhost:8081/clients' },
        authentication: { type: 'api-key', apiKey: 'x' },
      } as never,
      null,
    ).subscribe();
    actions$.next(connectKnowledgeBoardSocket());

    restoreKnowledgeBoardSocketClient$(action$ as never, fakeStore as never).subscribe();
    selected$.next('client-42');
    setting$.next(false);
    action$.next(connectKnowledgeBoardSocketSuccess());

    setTimeout(() => {
      expect(getKnowledgeBoardSocketInstance()).not.toBeNull();
      expect(mockSocket.emit).toHaveBeenCalledWith('setClient', { clientId: 'client-42' });
      done();
    }, 150);
  });
});
