import { HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { type Action, Store } from '@ngrx/store';
import { catchError, concatMap, filter, map, Observable, of, switchMap, take, tap, throttleTime } from 'rxjs';
import { io, Socket } from 'socket.io-client';

import { ActionCenterService } from '../../services/action-center.service';
import {
  ACTION_CENTER_ENVIRONMENT,
  ACTION_CENTER_SOCKET_AUTH,
  type ActionCenterSocketAuth,
} from '../../tokens/action-center-environment';
import type { ActionCenterView } from '../../types/action-center.types';

import {
  actionCenterConnected,
  actionCenterConnectionLost,
  actionCenterDisconnected,
  actionCenterReconnecting,
  actionCenterSilenceFailure,
  actionCenterViewReceived,
  connectActionCenter,
  disconnectActionCenter,
  loadActionCenter,
  loadActionCenterFailure,
  removeActionCenterSilence,
  setActionCenterPanelOpen,
  silenceActionCenterItem,
  toggleActionCenterPanel,
} from './action-center.actions';
import { ACTION_CENTER_PANEL_STORAGE_KEY } from './action-center.reducer';
import { selectActionCenterPanelOpen } from './action-center.selectors';

/** Server → client event names (see the backend gateway). */
export const ACTION_CENTER_SOCKET_EVENTS = { snapshot: 'actionCenterSnapshot', error: 'error' } as const;

/** REST fallback while the socket is down: at most once per interval. */
const FALLBACK_LOAD_INTERVAL_MS = 30_000;
/** Delay before reconnecting after the server ended the session. */
const SERVER_DISCONNECT_RETRY_MS = 5_000;
const retryTimers = new Set<ReturnType<typeof setTimeout>>();
let actionCenterSocket: Socket | null = null;

export function getActionCenterSocketInstance(): Socket | null {
  return actionCenterSocket;
}

function closeSocket(): void {
  for (const timer of retryTimers) {
    clearTimeout(timer);
  }

  retryTimers.clear();

  if (actionCenterSocket) {
    actionCenterSocket.removeAllListeners();
    actionCenterSocket.io.removeAllListeners();
    actionCenterSocket.disconnect();
    actionCenterSocket = null;
  }
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof HttpErrorResponse) {
    const body = error.error as { message?: unknown } | null;

    return typeof body?.message === 'string' ? body.message : error.message || fallback;
  }

  return error instanceof Error ? error.message : fallback;
}

/**
 * Live connection: one socket per console session. The handshake `auth` is resolved on every (re)connect (fresh
 * session token), reconnects never give up (backoff up to 30 s) and every push replaces the view.
 */
export const connectActionCenter$ = createEffect(
  (
    actions$ = inject(Actions),
    environment = inject(ACTION_CENTER_ENVIRONMENT),
    resolveAuth = inject(ACTION_CENTER_SOCKET_AUTH),
  ) =>
    actions$.pipe(
      ofType(connectActionCenter),
      // A second connect while connected keeps the live socket.
      filter(() => !actionCenterSocket?.connected),
      switchMap(() => {
        closeSocket();

        const extra = environment.socketAuthExtra ?? {};
        const socket = io(environment.websocketUrl, {
          transports: ['websocket'],
          reconnection: true,
          reconnectionAttempts: Infinity,
          reconnectionDelay: 1_000,
          reconnectionDelayMax: 30_000,
          randomizationFactor: 0.5,
          extraHeaders: environment.socketHeaders,
          auth: (callback: (data: Record<string, unknown>) => void) => {
            resolveAuth()
              .pipe(take(1))
              .subscribe({
                next: (auth: ActionCenterSocketAuth | null) => {
                  if (!auth) {
                    callback({ ...extra });
                  } else if (typeof auth === 'function') {
                    auth((data) => callback({ ...data, ...extra }));
                  } else {
                    callback({ ...auth, ...extra });
                  }
                },
                error: () => callback({ ...extra }),
              });
          },
        });

        actionCenterSocket = socket;

        return new Observable<Action>((subscriber) => {
          socket.on('connect', () => subscriber.next(actionCenterConnected()));
          socket.on(ACTION_CENTER_SOCKET_EVENTS.snapshot, (view: ActionCenterView) =>
            subscriber.next(actionCenterViewReceived({ view })),
          );
          socket.on('connect_error', (error: Error) =>
            subscriber.next(actionCenterConnectionLost({ error: error?.message || 'Connection failed' })),
          );
          socket.on('disconnect', (reason: string) => {
            if (reason === 'io client disconnect') {
              return;
            }

            // The server ended the session (expired / revoked token, lost access). socket.io does not reconnect on
            // its own here: retry once with freshly resolved auth; a real loss of access fails the handshake and
            // falls back to the regular backoff.
            if (reason === 'io server disconnect') {
              subscriber.next(actionCenterConnectionLost({ error: 'Disconnected by the server' }));

              const retry = setTimeout(() => {
                retryTimers.delete(retry);

                if (actionCenterSocket === socket) {
                  socket.connect();
                }
              }, SERVER_DISCONNECT_RETRY_MS);

              retryTimers.add(retry);

              return;
            }

            subscriber.next(actionCenterReconnecting({ attempt: 0 }));
          });
          socket.io.on('reconnect_attempt', (attempt: number) =>
            subscriber.next(actionCenterReconnecting({ attempt })),
          );

          return () => {
            if (actionCenterSocket === socket) {
              closeSocket();
            }
          };
        });
      }),
    ),
  { functional: true },
);

export const disconnectActionCenter$ = createEffect(
  (actions$ = inject(Actions)) =>
    actions$.pipe(
      ofType(disconnectActionCenter),
      tap(() => closeSocket()),
      map(() => actionCenterDisconnected()),
    ),
  { functional: true },
);

/** Initial / fallback REST load. */
export const loadActionCenter$ = createEffect(
  (actions$ = inject(Actions), service = inject(ActionCenterService)) =>
    actions$.pipe(
      ofType(loadActionCenter),
      switchMap(() =>
        service.getView().pipe(
          map((view) => actionCenterViewReceived({ view })),
          catchError((error: unknown) =>
            of(loadActionCenterFailure({ error: errorMessage(error, 'Failed to load the action center') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

/** While the socket cannot connect, keep the badge useful with an occasional REST load. */
export const actionCenterFallbackLoad$ = createEffect(
  (actions$ = inject(Actions)) =>
    actions$.pipe(
      ofType(actionCenterConnectionLost),
      throttleTime(FALLBACK_LOAD_INTERVAL_MS),
      map(() => loadActionCenter()),
    ),
  { functional: true },
);

export const silenceActionCenterItem$ = createEffect(
  (actions$ = inject(Actions), service = inject(ActionCenterService)) =>
    actions$.pipe(
      ofType(silenceActionCenterItem, removeActionCenterSilence),
      concatMap((action) =>
        (action.type === silenceActionCenterItem.type
          ? service.createSilence(action.silence)
          : service.removeSilence(action.silenceId)
        ).pipe(
          map((view) => actionCenterViewReceived({ view })),
          catchError((error: unknown) =>
            of(actionCenterSilenceFailure({ error: errorMessage(error, 'Failed to update the silence') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

/** Remembers whether the panel is open (restored on the next visit). */
export const persistActionCenterPanel$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store)) =>
    actions$.pipe(
      ofType(setActionCenterPanelOpen, toggleActionCenterPanel),
      switchMap(() => store.select(selectActionCenterPanelOpen).pipe(take(1))),
      tap((open) => {
        try {
          globalThis.localStorage?.setItem(ACTION_CENTER_PANEL_STORAGE_KEY, String(open));
        } catch {
          // Storage may be unavailable (private mode); the panel then simply starts closed.
        }
      }),
    ),
  { functional: true, dispatch: false },
);

/** Every effect of the slice, for `provideEffects`. */
export const actionCenterEffects = {
  connectActionCenter$,
  disconnectActionCenter$,
  loadActionCenter$,
  actionCenterFallbackLoad$,
  silenceActionCenterItem$,
  persistActionCenterPanel$,
};

/** For tests: drop the module-level socket. */
export function resetActionCenterSocketForTests(): void {
  closeSocket();
}
