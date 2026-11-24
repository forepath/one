import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { Action } from '@ngrx/store';
import { provideMockStore } from '@ngrx/store/testing';
import { firstValueFrom, of, ReplaySubject, Subject, take, throwError, toArray } from 'rxjs';

import { ActionCenterService } from '../../services/action-center.service';
import { ACTION_CENTER_ENVIRONMENT, ACTION_CENTER_SOCKET_AUTH } from '../../tokens/action-center-environment';
import type { ActionCenterView } from '../../types/action-center.types';

import {
  actionCenterConnected,
  actionCenterConnectionLost,
  actionCenterSilenceFailure,
  actionCenterViewReceived,
  connectActionCenter,
  disconnectActionCenter,
  loadActionCenter,
  loadActionCenterFailure,
  removeActionCenterSilence,
  setActionCenterPanelOpen,
  silenceActionCenterItem,
} from './action-center.actions';
import {
  actionCenterFallbackLoad$,
  connectActionCenter$,
  disconnectActionCenter$,
  loadActionCenter$,
  persistActionCenterPanel$,
  resetActionCenterSocketForTests,
  silenceActionCenterItem$,
} from './action-center.effects';
import { ACTION_CENTER_FEATURE_KEY, ACTION_CENTER_PANEL_STORAGE_KEY } from './action-center.reducer';

type Handler = (...args: unknown[]) => void;

interface FakeSocket {
  connected: boolean;
  handlers: Record<string, Handler>;
  managerHandlers: Record<string, Handler>;
  options: Record<string, unknown>;
  on: jest.Mock;
  removeAllListeners: jest.Mock;
  disconnect: jest.Mock;
  io: { on: jest.Mock; removeAllListeners: jest.Mock };
}

const sockets: FakeSocket[] = [];

jest.mock('socket.io-client', () => ({
  io: jest.fn((_url: string, options: Record<string, unknown>) => {
    const socket: FakeSocket = {
      connected: false,
      handlers: {},
      managerHandlers: {},
      options,
      on: jest.fn((event: string, handler: Handler) => (socket.handlers[event] = handler)),
      removeAllListeners: jest.fn(),
      disconnect: jest.fn(),
      io: {
        on: jest.fn((event: string, handler: Handler) => (socket.managerHandlers[event] = handler)),
        removeAllListeners: jest.fn(),
      },
    };

    sockets.push(socket);

    return socket;
  }),
}));

const view: ActionCenterView = {
  generatedAt: '2026-11-24T10:00:00.000Z',
  role: 'manager',
  canSilenceForEveryone: false,
  counts: { open: 1, setup: 0, silenced: 0 },
  groups: [],
  silences: [],
};

describe('action center effects', () => {
  let actions$: Subject<Action>;
  const service = { getView: jest.fn(), createSilence: jest.fn(), removeSilence: jest.fn() };

  beforeEach(() => {
    sockets.length = 0;
    actions$ = new ReplaySubject<Action>();
    jest.clearAllMocks();
    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() => actions$),
        provideMockStore({ initialState: { [ACTION_CENTER_FEATURE_KEY]: { panelOpen: true } } }),
        { provide: ActionCenterService, useValue: service },
        {
          provide: ACTION_CENTER_ENVIRONMENT,
          useValue: {
            apiUrl: 'http://api',
            basePath: 'admin/action-center',
            websocketUrl: 'http://api/socket/action-center',
            socketAuthExtra: { tenantId: 'decabill' },
          },
        },
        { provide: ACTION_CENTER_SOCKET_AUTH, useValue: () => of({ Authorization: 'Bearer token' }) },
      ],
    });
  });

  afterEach(() => resetActionCenterSocketForTests());

  it('loads the view over REST', async () => {
    service.getView.mockReturnValueOnce(of(view));
    actions$.next(loadActionCenter());

    expect(await firstValueFrom(TestBed.runInInjectionContext(() => loadActionCenter$()))).toEqual(
      actionCenterViewReceived({ view }),
    );
  });

  it('reports REST failures with the server message', async () => {
    service.getView.mockReturnValueOnce(
      throwError(() => new HttpErrorResponse({ status: 403, error: { message: 'Forbidden for you' } })),
    );
    actions$.next(loadActionCenter());

    expect(await firstValueFrom(TestBed.runInInjectionContext(() => loadActionCenter$()))).toEqual(
      loadActionCenterFailure({ error: 'Forbidden for you' }),
    );
  });

  it('silences and lifts silences, applying the returned view', async () => {
    service.createSilence.mockReturnValue(of(view));
    service.removeSilence.mockReturnValue(throwError(() => new Error('nope')));
    actions$.next(silenceActionCenterItem({ silence: { itemType: 'a.b', audience: 'self' } }));
    actions$.next(removeActionCenterSilence({ silenceId: 's-1' }));

    const results = await firstValueFrom(
      TestBed.runInInjectionContext(() => silenceActionCenterItem$()).pipe(take(2), toArray()),
    );

    expect(service.createSilence).toHaveBeenCalledWith({ itemType: 'a.b', audience: 'self' });
    expect(service.removeSilence).toHaveBeenCalledWith('s-1');
    expect(results).toEqual([actionCenterViewReceived({ view }), actionCenterSilenceFailure({ error: 'nope' })]);
  });

  it('connects once, re-resolves auth per handshake and maps socket events', async () => {
    const emitted: Action[] = [];
    const subscription = TestBed.runInInjectionContext(() => connectActionCenter$()).subscribe((action) =>
      emitted.push(action),
    );

    actions$.next(connectActionCenter());

    expect(sockets).toHaveLength(1);
    const socket = sockets[0];

    expect(socket.options['reconnectionAttempts']).toBe(Infinity);

    // auth is a callback: the token is resolved for every (re)connect and merged with the extra fields.
    const auth = socket.options['auth'] as (cb: (data: Record<string, unknown>) => void) => void;
    const payload = await new Promise((resolve) => auth(resolve));

    expect(payload).toEqual({ Authorization: 'Bearer token', tenantId: 'decabill' });

    socket.handlers['connect']();
    socket.handlers['actionCenterSnapshot'](view);
    socket.handlers['connect_error'](new Error('Unauthorized'));
    socket.handlers['disconnect']('io server disconnect');

    expect(emitted).toEqual([
      actionCenterConnected(),
      actionCenterViewReceived({ view }),
      actionCenterConnectionLost({ error: 'Unauthorized' }),
      actionCenterConnectionLost({ error: 'Disconnected by the server' }),
    ]);
    emitted.length = 0;

    // After a server-side disconnect the client reconnects once with fresh auth.
    jest.useFakeTimers();
    (socket as unknown as { connect: jest.Mock }).connect = jest.fn();
    socket.handlers['disconnect']('io server disconnect');
    jest.advanceTimersByTime(5_000);
    expect((socket as unknown as { connect: jest.Mock }).connect).toHaveBeenCalled();
    jest.useRealTimers();

    // A second connect while connected keeps the socket.
    socket.connected = true;
    actions$.next(connectActionCenter());
    expect(sockets).toHaveLength(1);
    subscription.unsubscribe();
  });

  it('disconnects the socket', async () => {
    TestBed.runInInjectionContext(() => connectActionCenter$()).subscribe();
    actions$.next(connectActionCenter());
    actions$.next(disconnectActionCenter());

    await firstValueFrom(TestBed.runInInjectionContext(() => disconnectActionCenter$()).pipe(take(1)));

    expect(sockets[0].disconnect).toHaveBeenCalled();
  });

  it('falls back to REST while the socket is down (throttled)', async () => {
    actions$.next(actionCenterConnectionLost({ error: 'x' }));
    actions$.next(actionCenterConnectionLost({ error: 'x' }));
    actions$.complete();

    const results = await firstValueFrom(
      TestBed.runInInjectionContext(() => actionCenterFallbackLoad$()).pipe(toArray()),
    );

    expect(results).toEqual([loadActionCenter()]);
  });

  it('persists the panel state', async () => {
    const setItem = jest.spyOn(Storage.prototype, 'setItem');

    actions$.next(setActionCenterPanelOpen({ open: true }));
    await firstValueFrom(TestBed.runInInjectionContext(() => persistActionCenterPanel$()).pipe(take(1)));

    expect(setItem).toHaveBeenCalledWith(ACTION_CENTER_PANEL_STORAGE_KEY, 'true');
    setItem.mockRestore();
  });
});
