import { inject } from '@angular/core';
import type { Environment } from '@forepath/shared/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { KeycloakService } from 'keycloak-angular';
import {
  catchError,
  delay,
  filter,
  from,
  fromEvent,
  map,
  merge,
  Observable,
  of,
  switchMap,
  take,
  tap,
  withLatestFrom,
} from 'rxjs';
import { io, Socket } from 'socket.io-client';

import { ticketAutomationRunChatSummaryToResponseDto } from '../../utils/ticket-automation-chat-run-mapper';
import { ticketBoardAutomationRunUpsert } from '../ticket-automation/ticket-automation.actions';
import { ticketBoardTicketUpsert } from '../tickets/tickets.actions';
import type { TicketResponseDto } from '../tickets/tickets.types';

import {
  CLIENT_CHAT_AUTOMATION_SOCKET_EVENT,
  CLIENT_CHAT_TICKET_UPSERT_SOCKET_EVENT,
} from './client-chat-automation.constants';
import {
  connectSocket,
  connectSocketFailure,
  connectSocketSuccess,
  disconnectSocket,
  disconnectSocketSuccess,
  forwardedEventReceived,
  forwardEvent,
  forwardEventSuccess,
  remoteDisconnected,
  remoteReconnected,
  remoteReconnectError,
  remoteReconnectFailed,
  remoteReconnecting,
  setClient,
  setClientSuccess,
  socketError,
  socketReconnected,
  socketReconnectError,
  socketReconnectFailed,
  socketReconnecting,
} from './sockets.actions';
import { selectSelectedAgentId, selectSelectedClientId, selectSettingClient } from './sockets.selectors';
import {
  ForwardableEvent,
  type ForwardedEventPayload,
  type TicketAutomationRunChatEventPayload,
} from './sockets.types';

/**
 * Socket.IO internal events that should not be forwarded or handled as application events
 */
const INTERNAL_EVENTS = new Set([
  'connect',
  'disconnect',
  'connect_error',
  'reconnect',
  'reconnect_attempt',
  'reconnecting',
  'reconnect_error',
  'reconnect_failed',
  'ping',
  'pong',
]);
const API_KEY_STORAGE_KEY = 'agent-controller-api-key';
const USERS_JWT_STORAGE_KEY = 'agent-controller-users-jwt';

/**
 * Gets the authentication header for socket connection.
 * Mirrors the HTTP auth interceptor: api-key (env or localStorage), keycloak, or users JWT.
 */
function getAuthHeader(environment: Environment, keycloakService: KeycloakService | null): Observable<string | null> {
  if (environment.authentication.type === 'api-key') {
    const apiKey =
      environment.authentication.apiKey ??
      (typeof localStorage !== 'undefined' ? localStorage.getItem(API_KEY_STORAGE_KEY) : null);

    if (apiKey) {
      return of(`Bearer ${apiKey}`);
    }

    return of(null);
  }

  if (environment.authentication.type === 'keycloak' && keycloakService) {
    return from(keycloakService.getToken()).pipe(
      map((token) => (token ? `Bearer ${token}` : null)),
      catchError((error) => {
        console.warn('Failed to get Keycloak token:', error);

        return of(null);
      }),
    );
  }

  if (environment.authentication.type === 'users') {
    const jwt = typeof localStorage !== 'undefined' ? localStorage.getItem(USERS_JWT_STORAGE_KEY) : null;

    if (jwt) {
      return of(`Bearer ${jwt}`);
    }

    return of(null);
  }

  return of(null);
}

/**
 * Global socket instance - managed by the connect effect
 * This is a shared reference that will be used by the facade for emitting events
 */
let socketInstance: Socket | null = null;

/**
 * Get the current socket instance (for use in facade/service)
 */
export function getSocketInstance(): Socket | null {
  return socketInstance;
}

/**
 * Effect to connect to the socket
 */
export const connectSocket$ = createEffect(
  (
    actions$ = inject(Actions),
    environment = inject<Environment>(ENVIRONMENT),
    keycloakService = inject(KeycloakService, { optional: true }),
  ) => {
    return actions$.pipe(
      ofType(connectSocket),
      switchMap(() => {
        const websocketUrl = environment.controller.websocketUrl;

        if (!websocketUrl) {
          return of(connectSocketFailure({ error: 'WebSocket URL not configured' }));
        }

        // Disconnect existing socket if any
        if (socketInstance) {
          socketInstance.disconnect();
          socketInstance = null;
        }

        // Get auth header (async for Keycloak)
        return getAuthHeader(environment, keycloakService).pipe(
          switchMap((authHeader) => {
            // Create socket connection with reconnection enabled.
            // Use auth (not extraHeaders): browser WebSocket API does not support custom headers,
            // so extraHeaders is ignored when transports: ['websocket']. The auth option is sent
            // in the handshake packet and works with WebSocket transport.
            socketInstance = io(websocketUrl, {
              transports: ['websocket'],
              rejectUnauthorized: false,
              reconnection: true,
              reconnectionAttempts: 5,
              reconnectionDelay: 1000,
              reconnectionDelayMax: 5000,
              randomizationFactor: 0.5,
              ...(authHeader && { auth: { Authorization: authHeader } }),
            });

            // Handle connection success
            const connectSuccess$ = fromEvent(socketInstance, 'connect').pipe(map(() => connectSocketSuccess()));
            // Handle connection errors
            // Note: connect_error fires on initial connection failure
            // Reconnection attempts are handled by reconnect_attempt/reconnect_error events
            const connectError$ = fromEvent<Error>(socketInstance, 'connect_error').pipe(
              map((error) => {
                // Only set failure on initial connection error if socket is not configured for reconnection
                // If reconnection is enabled, reconnect_failed will handle final failure
                // For now, we'll let reconnect_failed handle it, but log the error
                return socketReconnectError({ error: error.message || 'Connection error' });
              }),
            );
            // Handle main socket reconnection events
            const reconnectAttempt$ = fromEvent<number>(socketInstance, 'reconnect_attempt').pipe(
              map((attempt) => socketReconnecting({ attempt })),
            );
            const reconnecting$ = fromEvent<number>(socketInstance, 'reconnecting').pipe(
              map((attempt) => socketReconnecting({ attempt })),
            );
            const reconnect$ = fromEvent(socketInstance, 'reconnect').pipe(map(() => socketReconnected()));
            const reconnectError$ = fromEvent<Error>(socketInstance, 'reconnect_error').pipe(
              map((error) => socketReconnectError({ error: error.message || 'Reconnection error' })),
            );
            const reconnectFailed$ = fromEvent(socketInstance, 'reconnect_failed').pipe(
              map(() => {
                socketInstance = null;

                return socketReconnectFailed({ error: 'Reconnection failed after all attempts' });
              }),
            );
            // Handle setClientSuccess event
            const setClientSuccess$ = fromEvent<{ message: string; clientId: string }>(
              socketInstance,
              'setClientSuccess',
            ).pipe(map((data) => setClientSuccess({ message: data.message, clientId: data.clientId })));
            // Handle forwardAck event
            const forwardAck$ = fromEvent<{ received: boolean; event: string }>(socketInstance, 'forwardAck').pipe(
              map((data) => forwardEventSuccess({ received: data.received, event: data.event })),
            );
            // Handle error events (application-level errors, not Socket.IO internal errors)
            const error$ = fromEvent<{ message: string }>(socketInstance, 'error').pipe(
              map((data) => socketError({ message: data.message })),
            );
            // Handle remote disconnection/reconnection events (from backend, per clientId)
            const remoteDisconnected$ = fromEvent<{ clientId: string }>(socketInstance, 'remoteDisconnected').pipe(
              map((data) => remoteDisconnected({ clientId: data.clientId })),
            );
            const remoteReconnecting$ = fromEvent<{ clientId: string; attempt: number }>(
              socketInstance,
              'remoteReconnecting',
            ).pipe(map((data) => remoteReconnecting({ clientId: data.clientId, attempt: data.attempt })));
            const remoteReconnected$ = fromEvent<{ clientId: string }>(socketInstance, 'remoteReconnected').pipe(
              map((data) => remoteReconnected({ clientId: data.clientId })),
            );
            const remoteReconnectError$ = fromEvent<{ clientId: string; error: string }>(
              socketInstance,
              'remoteReconnectError',
            ).pipe(map((data) => remoteReconnectError({ clientId: data.clientId, error: data.error })));
            const remoteReconnectFailed$ = fromEvent<{ clientId: string; error: string }>(
              socketInstance,
              'remoteReconnectFailed',
            ).pipe(map((data) => remoteReconnectFailed({ clientId: data.clientId, error: data.error })));
            // Handle forwarded events from remote agents namespace
            // Listen to all events and filter out internal Socket.IO events
            const forwardedEvents$ = new Observable<{ event: string; payload: ForwardedEventPayload }>((subscriber) => {
              const handler = (event: string, ...args: unknown[]) => {
                // Only forward application-level events, not Socket.IO internal events
                if (!INTERNAL_EVENTS.has(event)) {
                  // Check if it's an internal Socket.IO error (Error instance) vs application error (plain object)
                  if (event === 'error' && args.length > 0 && args[0] instanceof Error) {
                    return; // Don't forward internal Socket.IO errors
                  }

                  // Type assertion: the payload should match ForwardedEventPayload based on event type
                  subscriber.next({ event, payload: (args[0] ?? {}) as ForwardedEventPayload });
                }
              };

              socketInstance?.onAny(handler);

              return () => {
                socketInstance?.offAny(handler);
              };
            }).pipe(map(({ event, payload }) => forwardedEventReceived({ event, payload })));

            // Merge all event streams
            return merge(
              connectSuccess$,
              connectError$,
              reconnectAttempt$,
              reconnecting$,
              reconnect$,
              reconnectError$,
              reconnectFailed$,
              setClientSuccess$,
              forwardAck$,
              error$,
              forwardedEvents$,
              remoteDisconnected$,
              remoteReconnecting$,
              remoteReconnected$,
              remoteReconnectError$,
              remoteReconnectFailed$,
            ).pipe(
              catchError((error) => {
                socketInstance = null;

                return of(connectSocketFailure({ error: error.message || 'Connection error' }));
              }),
            );
          }),
        );
      }),
    );
  },
  { functional: true },
);

/**
 * Effect to disconnect from the socket
 */
export const disconnectSocket$ = createEffect(
  (actions$ = inject(Actions)) => {
    return actions$.pipe(
      ofType(disconnectSocket),
      tap(() => {
        if (socketInstance) {
          socketInstance.disconnect();
          socketInstance = null;
        }
      }),
      map(() => disconnectSocketSuccess()),
    );
  },
  { functional: true },
);

/**
 * Effect to automatically restore client context after reconnection
 * When the socket reconnects, if there was a selected client before disconnection,
 * automatically restore it by calling setClient
 * Note: We handle both connectSocketSuccess and socketReconnected because:
 * - On reconnection, Socket.IO fires 'connect' first (connectSocketSuccess), then 'reconnect' (socketReconnected)
 * - We need to restore on the first one that has a selectedClientId
 * - On initial connection, there shouldn't be a selectedClientId, so nothing happens
 */
export const restoreClientContext$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store)) => {
    return actions$.pipe(
      ofType(connectSocketSuccess, socketReconnected),
      withLatestFrom(store.select(selectSelectedClientId), store.select(selectSettingClient)),
      // Prevent duplicate restorations by checking if we're already setting the client
      // This ensures we only restore once per reconnection, even if both events fire
      switchMap(([, selectedClientId, settingClient]) => {
        // Skip if we're already setting a client (prevents duplicate calls)
        if (settingClient) {
          return of();
        }

        // Only restore if we have a selected client (indicates this is a reconnection, not initial connection)
        if (!selectedClientId) {
          return of();
        }

        // Small delay to ensure the backend socket connection is fully established
        // This is important because on reconnection, the backend might not be ready immediately
        return of(null).pipe(
          delay(100),
          switchMap(() => {
            // Re-check socket instance after delay to ensure we have the latest reference
            const socket = getSocketInstance();

            // Only restore if the socket is connected
            if (socket && socket.connected) {
              // Emit setClient to restore the client context on the backend
              // This will create a new remote socket connection and update selectedClientBySocket
              socket.emit('setClient', { clientId: selectedClientId });

              // Return setClient action to update the state (this will trigger settingClient flag)
              return of(setClient({ clientId: selectedClientId }));
            }

            return of();
          }),
        );
      }),
      // Filter out empty observables
      filter((action) => action !== undefined && action !== null),
    );
  },
  { functional: true },
);

/**
 * Effect to automatically restore agent login after client context is restored
 * When setClientSuccess is received (after reconnection), if there was a selected agent before disconnection,
 * automatically log in to that agent to restore the login state
 *
 * Note: We use a race between remoteReconnected (for reconnections) and a timeout (for initial connections)
 * to ensure the remote socket is fully connected and ready before sending the login event.
 * This ensures that:
 * 1. The remote socket connection is fully established
 * 2. The onAny handler on the backend is ready to forward loginSuccess events
 * 3. The local socket is ready to receive forwarded events
 */
export const restoreAgentLogin$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store)) => {
    return actions$.pipe(
      ofType(setClientSuccess),
      withLatestFrom(store.select(selectSelectedAgentId), store.select(selectSelectedClientId)),
      switchMap(([, selectedAgentId, selectedClientId]) => {
        // Only restore login if we have a selected agent (indicates this is a reconnection, not initial connection)
        if (!selectedAgentId || !selectedClientId) {
          return of();
        }

        // Race between remoteReconnected (for reconnections) and a timeout (for initial connections)
        // This ensures we wait for the remote socket to be ready in both cases
        return merge(
          // Wait for remoteReconnected event (for reconnections)
          actions$.pipe(
            ofType(remoteReconnected),
            filter((action) => action.clientId === selectedClientId),
            take(1),
          ),
          // Fallback timeout for initial connections (setClientSuccess is emitted when remote connects)
          of(null).pipe(delay(1000)),
        ).pipe(
          take(1), // Take whichever completes first
          delay(300), // Additional delay to ensure onAny handler is fully ready
          switchMap(() => {
            // Re-check socket instance to ensure it's still connected
            const socket = getSocketInstance();

            if (!socket || !socket.connected) {
              // Socket disconnected, don't send login
              return of();
            }

            // Emit login event directly to the socket
            // We need to emit directly because forwardEvent action only dispatches to store,
            // but the actual socket emission happens in SocketsFacade.forwardEvent()
            socket.emit('forward', { event: ForwardableEvent.LOGIN, agentId: selectedAgentId });

            // Also dispatch the action to update the store state
            return of(forwardEvent({ event: ForwardableEvent.LOGIN, agentId: selectedAgentId }));
          }),
        );
      }),
      // Filter out empty observables
      filter((action) => action !== undefined && action !== null),
    );
  },
  { functional: true },
);

/**
 * Keeps ticket-automation run cache in sync with clients-namespace automation chat snapshots
 * so chat cards can merge live run status without subscribing to the tickets board socket.
 */
export const syncTicketAutomationRunFromClientsChat$ = createEffect(
  (actions$ = inject(Actions)) =>
    actions$.pipe(
      ofType(forwardedEventReceived),
      filter((a) => {
        if (a.event !== CLIENT_CHAT_AUTOMATION_SOCKET_EVENT) {
          return false;
        }

        const p = a.payload as TicketAutomationRunChatEventPayload;

        return !!p?.run?.id;
      }),
      map((a) =>
        ticketBoardAutomationRunUpsert({
          run: ticketAutomationRunChatSummaryToResponseDto((a.payload as TicketAutomationRunChatEventPayload).run),
        }),
      ),
    ),
  { functional: true },
);

/** Merge ticket list/detail from clients-namespace ticket snapshots (same payload as tickets-board `ticketUpsert`). */
export const syncTicketsFromClientsChatTicketUpsert$ = createEffect(
  (actions$ = inject(Actions)) =>
    actions$.pipe(
      ofType(forwardedEventReceived),
      filter((a) => a.event === CLIENT_CHAT_TICKET_UPSERT_SOCKET_EVENT),
      map((a) => ticketBoardTicketUpsert({ ticket: a.payload as unknown as TicketResponseDto })),
    ),
  { functional: true },
);
