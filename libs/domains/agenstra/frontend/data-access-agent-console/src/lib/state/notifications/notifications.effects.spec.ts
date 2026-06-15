import { KeycloakService } from 'keycloak-angular';
import { Subject } from 'rxjs';
import { io, Socket } from 'socket.io-client';

import {
  connectNotificationsSocket,
  connectNotificationsSocketFailure,
  connectNotificationsSocketSuccess,
  disconnectNotificationsSocket,
  markEnvironmentRead,
  notificationsSocketError,
  notificationsSocketReconnected,
  notificationsSocketReconnectError,
  notificationsSocketReconnectFailed,
  notificationsSocketReconnecting,
  playUnreadNotificationSound,
  setActiveEnvironment,
  setActiveEnvironmentLocal,
  statusPatchReceived,
  statusSnapshotReceived,
} from './notifications.actions';
import {
  connectNotificationsSocket$,
  disconnectNotificationsSocket$,
  getStatusSocketInstance,
  markEnvironmentRead$,
  playUnreadNotificationSound$,
  playUnreadSoundEffect$,
  setActiveEnvironment$,
} from './notifications.effects';
import { STATUS_SOCKET_EVENTS } from './status-socket.constants';

jest.mock('socket.io-client', () => ({
  io: jest.fn(),
}));
jest.mock('keycloak-angular', () => ({
  KeycloakService: jest.fn(),
}));

const testEnvironment = {
  production: false,
  controller: { restApiUrl: 'http://localhost:3000', websocketUrl: 'http://localhost:8081/clients' },
  billing: { restApiUrl: '', frontendUrl: '' },
  authentication: { type: 'api-key' as const, apiKey: 'test-key' },
  chatModelOptions: {},
  editor: { openInNewWindow: false },
  deployment: { openInNewWindow: false },
  cookieConsent: { domain: '', privacyPolicyUrl: '', termsUrl: '' },
};

describe('NotificationsEffects', () => {
  let actions$: Subject<ReturnType<typeof connectNotificationsSocket>>;
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

  it('connect effect fails when status websocket url is not configured', (done) => {
    connectNotificationsSocket$(
      actions$ as never,
      {
        ...testEnvironment,
        controller: { restApiUrl: 'http://localhost:3000' },
      } as never,
      null,
    ).subscribe((action) => {
      expect(action).toEqual(connectNotificationsSocketFailure({ error: 'Status WebSocket URL not configured' }));
      done();
    });

    actions$.next(connectNotificationsSocket());
  });

  it('connect effect maps snapshot and patch socket events to ngrx actions', (done) => {
    const received: unknown[] = [];
    const sub = connectNotificationsSocket$(actions$ as never, testEnvironment as never, null).subscribe((action) =>
      received.push(action),
    );

    actions$.next(connectNotificationsSocket());
    listeners.get(STATUS_SOCKET_EVENTS.statusSnapshot)?.({
      generatedAt: '2026-01-01T00:00:00.000Z',
      environments: [],
      clients: [],
      spacesHasAttention: false,
    });
    listeners.get(STATUS_SOCKET_EVENTS.statusPatch)?.({
      generatedAt: '2026-01-01T00:00:01.000Z',
      environments: [
        {
          clientId: 'c1',
          agentId: 'a1',
          hasUnreadMessages: true,
          gitDirty: false,
          gitConflict: false,
        },
      ],
    });

    setTimeout(() => {
      expect(received).toContainEqual(
        statusSnapshotReceived({
          snapshot: {
            generatedAt: '2026-01-01T00:00:00.000Z',
            environments: [],
            clients: [],
            spacesHasAttention: false,
          },
        }),
      );
      expect(received).toContainEqual(
        statusPatchReceived({
          patch: {
            generatedAt: '2026-01-01T00:00:01.000Z',
            environments: [
              {
                clientId: 'c1',
                agentId: 'a1',
                hasUnreadMessages: true,
                gitDirty: false,
                gitConflict: false,
              },
            ],
          },
        }),
      );
      sub.unsubscribe();
      done();
    }, 0);
  });

  it('disconnect effect disconnects active socket', (done) => {
    const disconnectActions$ = new Subject<ReturnType<typeof disconnectNotificationsSocket>>();

    connectNotificationsSocket$(actions$ as never, testEnvironment as never, null).subscribe();
    actions$.next(connectNotificationsSocket());

    disconnectNotificationsSocket$(disconnectActions$ as never).subscribe(() => {
      expect(mockSocket.disconnect).toHaveBeenCalled();
      expect(getStatusSocketInstance()).toBeNull();
      done();
    });

    disconnectActions$.next(disconnectNotificationsSocket());
    disconnectActions$.complete();
  });

  it('markEnvironmentRead effect emits socket event', () => {
    const markRead$ = new Subject<ReturnType<typeof markEnvironmentRead>>();

    connectNotificationsSocket$(actions$ as never, testEnvironment as never, null).subscribe();
    actions$.next(connectNotificationsSocket());
    markEnvironmentRead$(markRead$ as never).subscribe();

    markRead$.next(markEnvironmentRead({ clientId: 'c1', agentId: 'a1' }));

    expect(mockSocket.emit).toHaveBeenCalledWith(STATUS_SOCKET_EVENTS.markEnvironmentRead, {
      clientId: 'c1',
      agentId: 'a1',
    });
  });

  it('setActiveEnvironment effect emits socket event and updates local state', () => {
    const setActive$ = new Subject<ReturnType<typeof setActiveEnvironment>>();
    const dispatch = jest.fn();
    const fakeStore = { dispatch };

    connectNotificationsSocket$(actions$ as never, testEnvironment as never, null).subscribe();
    actions$.next(connectNotificationsSocket());
    setActiveEnvironment$(setActive$ as never, fakeStore as never).subscribe();

    setActive$.next(setActiveEnvironment({ clientId: 'c1', agentId: 'a1' }));

    expect(mockSocket.emit).toHaveBeenCalledWith(STATUS_SOCKET_EVENTS.setActiveEnvironment, {
      clientId: 'c1',
      agentId: 'a1',
    });
    expect(dispatch).toHaveBeenCalledWith(setActiveEnvironmentLocal({ active: { clientId: 'c1', agentId: 'a1' } }));
  });

  it('connect effect uses api key from localStorage when env key is absent', async () => {
    const getItem = jest.spyOn(Storage.prototype, 'getItem').mockReturnValue('stored-key');

    connectNotificationsSocket$(
      actions$ as never,
      {
        ...testEnvironment,
        authentication: { type: 'api-key' as const },
      } as never,
      null,
    ).subscribe();

    actions$.next(connectNotificationsSocket());
    await Promise.resolve();

    expect(io).toHaveBeenCalledWith(
      'http://localhost:8081/status',
      expect.objectContaining({
        auth: { Authorization: 'Bearer stored-key' },
      }),
    );
    getItem.mockRestore();
  });

  it('connect effect uses keycloak token when configured', async () => {
    const keycloak = { getToken: jest.fn().mockResolvedValue('kc-token') } as unknown as KeycloakService;

    connectNotificationsSocket$(
      actions$ as never,
      {
        ...testEnvironment,
        authentication: { type: 'keycloak' as const },
      } as never,
      keycloak,
    ).subscribe();

    actions$.next(connectNotificationsSocket());
    await Promise.resolve();

    expect(keycloak.getToken).toHaveBeenCalled();
    expect(io).toHaveBeenCalledWith(
      'http://localhost:8081/status',
      expect.objectContaining({
        auth: { Authorization: 'Bearer kc-token' },
      }),
    );
  });

  it('connect effect maps reconnect and error socket events', (done) => {
    const received: unknown[] = [];
    const sub = connectNotificationsSocket$(actions$ as never, testEnvironment as never, null).subscribe((action) =>
      received.push(action),
    );

    actions$.next(connectNotificationsSocket());
    listeners.get('connect')?.();
    listeners.get('connect_error')?.(new Error('connect failed'));
    listeners.get('reconnect_attempt')?.(2);
    listeners.get('reconnect')?.();
    listeners.get('reconnect_error')?.(new Error('reconnect failed'));
    listeners.get('reconnect_failed')?.();
    listeners.get('error')?.({ message: 'server error' });

    setTimeout(() => {
      expect(received).toContainEqual(connectNotificationsSocketSuccess());
      expect(received).toContainEqual(connectNotificationsSocketFailure({ error: 'connect failed' }));
      expect(received).toContainEqual(notificationsSocketReconnecting({ attempt: 2 }));
      expect(received).toContainEqual(notificationsSocketReconnected());
      expect(received).toContainEqual(notificationsSocketReconnectError({ error: 'reconnect failed' }));
      expect(received).toContainEqual(
        notificationsSocketReconnectFailed({ error: 'Reconnection failed after all attempts' }),
      );
      expect(received).toContainEqual(notificationsSocketError({ message: 'server error' }));
      sub.unsubscribe();
      done();
    }, 0);
  });

  it('playUnreadNotificationSound effect dispatches when no active environment', (done) => {
    const patchActions$ = new Subject<ReturnType<typeof statusPatchReceived>>();
    const active$ = new Subject<{ clientId: string; agentId: string } | null>();
    const fakeStore = {
      select: jest.fn().mockReturnValue(active$),
    };

    playUnreadNotificationSound$(patchActions$ as never, fakeStore as never).subscribe((action) => {
      expect(action).toEqual(playUnreadNotificationSound());
      done();
    });

    active$.next(null);
    patchActions$.next(
      statusPatchReceived({
        patch: {
          generatedAt: '2026-01-01T00:00:00.000Z',
          environments: [
            {
              clientId: 'c1',
              agentId: 'a1',
              hasUnreadMessages: true,
              gitDirty: false,
              gitConflict: false,
            },
          ],
        },
      }),
    );
  });

  it('playUnreadSoundEffect plays notification audio', () => {
    const play = jest.fn().mockResolvedValue(undefined);
    const audioCtor = jest.fn().mockImplementation(() => ({
      volume: 0,
      currentTime: 0,
      play,
    }));

    (global as { Audio?: typeof Audio }).Audio = audioCtor as unknown as typeof Audio;

    const soundActions$ = new Subject<ReturnType<typeof playUnreadNotificationSound>>();

    playUnreadSoundEffect$(soundActions$ as never).subscribe();
    soundActions$.next(playUnreadNotificationSound());

    expect(audioCtor).toHaveBeenCalledWith('/audio/notification-pling.wav');
    expect(play).toHaveBeenCalled();
  });

  it('playUnreadNotificationSound effect dispatches when unread is outside active environment', (done) => {
    const patchActions$ = new Subject<ReturnType<typeof statusPatchReceived>>();
    const active$ = new Subject<{ clientId: string; agentId: string } | null>();
    const fakeStore = {
      select: jest.fn().mockReturnValue(active$),
    };

    playUnreadNotificationSound$(patchActions$ as never, fakeStore as never).subscribe((action) => {
      expect(action).toEqual(playUnreadNotificationSound());
      done();
    });

    active$.next({ clientId: 'c-active', agentId: 'a-active' });
    patchActions$.next(
      statusPatchReceived({
        patch: {
          generatedAt: '2026-01-01T00:00:00.000Z',
          environments: [
            {
              clientId: 'c-other',
              agentId: 'a-other',
              hasUnreadMessages: true,
              gitDirty: false,
              gitConflict: false,
            },
          ],
        },
      }),
    );
  });
});
