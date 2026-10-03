import { inject } from '@angular/core';
import type { Environment } from '@forepath/agenstra/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/agenstra/frontend/util-configuration';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { KeycloakService } from 'keycloak-angular';
import { catchError, filter, from, fromEvent, map, merge, Observable, of, switchMap, tap, withLatestFrom } from 'rxjs';
import { io, Socket } from 'socket.io-client';

import { resolveStatusWebsocketUrl } from './notifications-websocket-url';
import {
  connectNotificationsSocket,
  connectNotificationsSocketFailure,
  connectNotificationsSocketSuccess,
  disconnectNotificationsSocket,
  disconnectNotificationsSocketSuccess,
  markEnvironmentRead,
  markChatSessionRead,
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
import { selectActiveEnvironment } from './notifications.selectors';
import type { StatusPatchPayload, StatusSnapshotPayload } from './notifications.types';
import { STATUS_SOCKET_EVENTS } from './status-socket.constants';

export { resolveStatusWebsocketUrl } from './notifications-websocket-url';

const API_KEY_STORAGE_KEY = 'agent-controller-api-key';
const USERS_JWT_STORAGE_KEY = 'agent-controller-users-jwt';
const NOTIFICATION_SOUND_URL = '/audio/notification-pling.wav';

function getAuthHeader(environment: Environment, keycloakService: KeycloakService | null): Observable<string | null> {
  if (environment.authentication.config.type === 'api-key') {
    const apiKey =
      environment.authentication.config.apiKey ??
      (typeof localStorage !== 'undefined' ? localStorage.getItem(API_KEY_STORAGE_KEY) : null);

    return of(apiKey ? `Bearer ${apiKey}` : null);
  }

  if (environment.authentication.config.type === 'keycloak' && keycloakService) {
    return from(keycloakService.getToken()).pipe(
      map((token) => (token ? `Bearer ${token}` : null)),
      catchError(() => of(null)),
    );
  }

  if (environment.authentication.config.type === 'users') {
    const jwt = typeof localStorage !== 'undefined' ? localStorage.getItem(USERS_JWT_STORAGE_KEY) : null;

    return of(jwt ? `Bearer ${jwt}` : null);
  }

  return of(null);
}

let statusSocketInstance: Socket | null = null;
let notificationAudio: HTMLAudioElement | null = null;
let pendingActiveEnvironment: {
  clientId: string | null;
  agentId: string | null;
  chatSessionId?: string | null;
} | null = null;
let pendingChatSessionRead: { clientId: string; agentId: string; chatSessionId: string } | null = null;
let pendingEnvironmentRead: { clientId: string; agentId: string; chatSessionId?: string } | null = null;

export function getStatusSocketInstance(): Socket | null {
  return statusSocketInstance;
}

/** @internal Test helper — reset module-level pending emit buffers. */
export function resetStatusSocketPendingEmitsForTests(): void {
  pendingActiveEnvironment = null;
  pendingChatSessionRead = null;
  pendingEnvironmentRead = null;
}

function flushPendingStatusEmits(): void {
  if (!statusSocketInstance?.connected) {
    return;
  }

  if (pendingActiveEnvironment) {
    statusSocketInstance.emit(STATUS_SOCKET_EVENTS.setActiveEnvironment, pendingActiveEnvironment);
  }

  if (pendingChatSessionRead) {
    statusSocketInstance.emit(STATUS_SOCKET_EVENTS.markChatSessionRead, pendingChatSessionRead);
  }

  if (pendingEnvironmentRead) {
    statusSocketInstance.emit(STATUS_SOCKET_EVENTS.markEnvironmentRead, pendingEnvironmentRead);
  }
}

function playNotificationSound(): void {
  if (typeof Audio === 'undefined') {
    return;
  }

  if (!notificationAudio) {
    notificationAudio = new Audio(NOTIFICATION_SOUND_URL);
    notificationAudio.volume = 0.5;
  }

  notificationAudio.currentTime = 0;
  void notificationAudio.play().catch(() => undefined);
}

export const connectNotificationsSocket$ = createEffect(
  (
    actions$ = inject(Actions),
    environment = inject<Environment>(ENVIRONMENT),
    keycloakService = inject(KeycloakService, { optional: true }),
  ) =>
    actions$.pipe(
      ofType(connectNotificationsSocket),
      switchMap(() => {
        const websocketUrl = resolveStatusWebsocketUrl(environment);

        if (!websocketUrl) {
          return of(connectNotificationsSocketFailure({ error: 'Status WebSocket URL not configured' }));
        }

        if (statusSocketInstance) {
          statusSocketInstance.disconnect();
          statusSocketInstance = null;
        }

        return getAuthHeader(environment, keycloakService).pipe(
          switchMap((authHeader) => {
            statusSocketInstance = io(websocketUrl, {
              transports: ['websocket'],
              rejectUnauthorized: false,
              reconnection: true,
              reconnectionAttempts: 5,
              reconnectionDelay: 1000,
              reconnectionDelayMax: 5000,
              randomizationFactor: 0.5,
              ...(authHeader && { auth: { Authorization: authHeader } }),
            });

            const connectSuccess$ = fromEvent(statusSocketInstance, 'connect').pipe(
              tap(() => flushPendingStatusEmits()),
              map(() => connectNotificationsSocketSuccess()),
            );
            const connectError$ = fromEvent<Error>(statusSocketInstance, 'connect_error').pipe(
              map((error) => connectNotificationsSocketFailure({ error: error.message || 'Connection error' })),
            );
            const reconnectAttempt$ = merge(
              fromEvent<number>(statusSocketInstance, 'reconnect_attempt'),
              fromEvent<number>(statusSocketInstance, 'reconnecting'),
            ).pipe(map((attempt) => notificationsSocketReconnecting({ attempt })));
            const reconnect$ = fromEvent(statusSocketInstance, 'reconnect').pipe(
              tap(() => flushPendingStatusEmits()),
              map(() => notificationsSocketReconnected()),
            );
            const reconnectError$ = fromEvent<Error>(statusSocketInstance, 'reconnect_error').pipe(
              map((error) => notificationsSocketReconnectError({ error: error.message || 'Reconnection error' })),
            );
            const reconnectFailed$ = fromEvent(statusSocketInstance, 'reconnect_failed').pipe(
              map(() => {
                statusSocketInstance = null;

                return notificationsSocketReconnectFailed({ error: 'Reconnection failed after all attempts' });
              }),
            );
            const snapshot$ = fromEvent<StatusSnapshotPayload>(
              statusSocketInstance,
              STATUS_SOCKET_EVENTS.statusSnapshot,
            ).pipe(map((snapshot) => statusSnapshotReceived({ snapshot })));
            const patch$ = fromEvent<StatusPatchPayload>(statusSocketInstance, STATUS_SOCKET_EVENTS.statusPatch).pipe(
              map((patch) => statusPatchReceived({ patch })),
            );
            const error$ = fromEvent<{ message: string }>(statusSocketInstance, 'error').pipe(
              map((data) => notificationsSocketError({ message: data.message })),
            );

            return merge(
              connectSuccess$,
              connectError$,
              reconnectAttempt$,
              reconnect$,
              reconnectError$,
              reconnectFailed$,
              snapshot$,
              patch$,
              error$,
            );
          }),
        );
      }),
    ),
  { functional: true, dispatch: true },
);

export const disconnectNotificationsSocket$ = createEffect(
  (actions$ = inject(Actions)) =>
    actions$.pipe(
      ofType(disconnectNotificationsSocket),
      tap(() => {
        if (statusSocketInstance) {
          statusSocketInstance.disconnect();
          statusSocketInstance = null;
        }
      }),
      map(() => disconnectNotificationsSocketSuccess()),
    ),
  { functional: true, dispatch: true },
);

export const markEnvironmentRead$ = createEffect(
  (actions$ = inject(Actions)) =>
    actions$.pipe(
      ofType(markEnvironmentRead),
      tap(({ clientId, agentId, chatSessionId }) => {
        pendingEnvironmentRead = { clientId, agentId, chatSessionId };

        if (statusSocketInstance?.connected) {
          statusSocketInstance.emit(STATUS_SOCKET_EVENTS.markEnvironmentRead, pendingEnvironmentRead);
        }
      }),
    ),
  { functional: true, dispatch: false },
);

export const markChatSessionRead$ = createEffect(
  (actions$ = inject(Actions)) =>
    actions$.pipe(
      ofType(markChatSessionRead),
      tap(({ clientId, agentId, chatSessionId }) => {
        pendingChatSessionRead = { clientId, agentId, chatSessionId };

        if (statusSocketInstance?.connected) {
          statusSocketInstance.emit(STATUS_SOCKET_EVENTS.markChatSessionRead, pendingChatSessionRead);
        }
      }),
    ),
  { functional: true, dispatch: false },
);

export const setActiveEnvironment$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store)) =>
    actions$.pipe(
      ofType(setActiveEnvironment),
      tap(({ clientId, agentId, chatSessionId }) => {
        pendingActiveEnvironment = { clientId, agentId, chatSessionId };

        if (statusSocketInstance?.connected) {
          statusSocketInstance.emit(STATUS_SOCKET_EVENTS.setActiveEnvironment, pendingActiveEnvironment);
        }

        store.dispatch(
          setActiveEnvironmentLocal({
            active: clientId && agentId ? { clientId, agentId, chatSessionId: chatSessionId ?? null } : null,
          }),
        );
      }),
    ),
  { functional: true, dispatch: false },
);

/** After snapshot, re-assert active chat + mark-read so reload races cannot drop the cursor. */
export const reassertActiveChatAfterSnapshot$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store)) =>
    actions$.pipe(
      ofType(statusSnapshotReceived),
      withLatestFrom(store.select(selectActiveEnvironment)),
      tap(([, active]) => {
        if (!statusSocketInstance?.connected || !active?.clientId || !active?.agentId) {
          return;
        }

        statusSocketInstance.emit(STATUS_SOCKET_EVENTS.setActiveEnvironment, {
          clientId: active.clientId,
          agentId: active.agentId,
          chatSessionId: active.chatSessionId,
        });

        if (active.chatSessionId) {
          statusSocketInstance.emit(STATUS_SOCKET_EVENTS.markChatSessionRead, {
            clientId: active.clientId,
            agentId: active.agentId,
            chatSessionId: active.chatSessionId,
          });
        }
      }),
    ),
  { functional: true, dispatch: false },
);

export const playUnreadNotificationSound$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store)) =>
    actions$.pipe(
      ofType(statusPatchReceived),
      withLatestFrom(store.select(selectActiveEnvironment)),
      filter(([{ patch }, active]) => {
        const changed = patch.environments?.some((e) => e.hasUnreadMessages) ?? false;

        if (!changed || !patch.environments?.length) {
          return false;
        }

        return patch.environments.some((env) => {
          if (!env.hasUnreadMessages) {
            return false;
          }

          if (!active) {
            return true;
          }

          return active.clientId !== env.clientId || active.agentId !== env.agentId;
        });
      }),
      map(() => playUnreadNotificationSound()),
    ),
  { functional: true, dispatch: true },
);

export const playUnreadSoundEffect$ = createEffect(
  (actions$ = inject(Actions)) =>
    actions$.pipe(
      ofType(playUnreadNotificationSound),
      tap(() => playNotificationSound()),
    ),
  { functional: true, dispatch: false },
);
