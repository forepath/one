import { inject } from '@angular/core';
import type { Environment } from '@forepath/shared/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { KeycloakService } from 'keycloak-angular';
import {
  catchError,
  delay,
  EMPTY,
  filter,
  from,
  fromEvent,
  map,
  merge,
  Observable,
  of,
  switchMap,
  tap,
  withLatestFrom,
} from 'rxjs';
import { io, Socket } from 'socket.io-client';

import { loadKnowledgeRelations } from '../knowledge/knowledge.actions';
import {
  ticketBoardAutomationRunStepAppended,
  ticketBoardAutomationRunUpsert,
  ticketBoardAutomationUpsert,
} from '../ticket-automation/ticket-automation.actions';
import {
  ticketBoardActivityCreated,
  ticketBoardCommentCreated,
  ticketBoardTicketRemoved,
  ticketBoardTicketUpsert,
} from '../tickets/tickets.actions';

import {
  connectTicketsBoardSocket,
  connectTicketsBoardSocketFailure,
  connectTicketsBoardSocketSuccess,
  disconnectTicketsBoardSocket,
  disconnectTicketsBoardSocketSuccess,
  setTicketsBoardSocketClientSuccess,
  ticketsBoardSocketError,
  ticketsBoardSocketReconnected,
  ticketsBoardSocketReconnectError,
  ticketsBoardSocketReconnectFailed,
  ticketsBoardSocketReconnecting,
} from './tickets-board-socket.actions';
import { TICKETS_BOARD_SOCKET_EVENTS } from './tickets-board-socket.constants';
import {
  selectTicketsBoardSocketSelectedClientId,
  selectTicketsBoardSocketSettingClient,
} from './tickets-board-socket.selectors';

const API_KEY_STORAGE_KEY = 'agent-controller-api-key';
const USERS_JWT_STORAGE_KEY = 'agent-controller-users-jwt';

export function resolveTicketsBoardWebsocketUrl(environment: Environment): string | null {
  const explicit = environment.controller.ticketsWebsocketUrl?.trim();

  if (explicit) {
    return explicit;
  }

  const base = environment.controller.websocketUrl?.trim();

  if (!base) {
    return null;
  }

  if (base.endsWith('/clients')) {
    return `${base.slice(0, -'/clients'.length)}/tickets`;
  }

  try {
    const u = new URL(base);
    const root = `${u.protocol}//${u.host}`;

    return `${root}/tickets`;
  } catch {
    return `${base.replace(/\/$/, '')}/tickets`;
  }
}

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

let ticketsBoardSocketInstance: Socket | null = null;

export function getTicketsBoardSocketInstance(): Socket | null {
  return ticketsBoardSocketInstance;
}

export const connectTicketsBoardSocket$ = createEffect(
  (
    actions$ = inject(Actions),
    environment = inject<Environment>(ENVIRONMENT),
    keycloakService = inject(KeycloakService, { optional: true }),
  ) => {
    return actions$.pipe(
      ofType(connectTicketsBoardSocket),
      switchMap(() => {
        const websocketUrl = resolveTicketsBoardWebsocketUrl(environment);

        if (!websocketUrl) {
          return of(connectTicketsBoardSocketFailure({ error: 'Tickets WebSocket URL not configured' }));
        }

        if (ticketsBoardSocketInstance) {
          ticketsBoardSocketInstance.disconnect();
          ticketsBoardSocketInstance = null;
        }

        return getAuthHeader(environment, keycloakService).pipe(
          switchMap((authHeader) => {
            ticketsBoardSocketInstance = io(websocketUrl, {
              transports: ['websocket'],
              rejectUnauthorized: false,
              reconnection: true,
              reconnectionAttempts: 5,
              reconnectionDelay: 1000,
              reconnectionDelayMax: 5000,
              randomizationFactor: 0.5,
              ...(authHeader && { auth: { Authorization: authHeader } }),
            });

            const connectSuccess$ = fromEvent(ticketsBoardSocketInstance, 'connect').pipe(
              map(() => connectTicketsBoardSocketSuccess()),
            );
            const connectError$ = fromEvent<Error>(ticketsBoardSocketInstance, 'connect_error').pipe(
              map((error) => ticketsBoardSocketReconnectError({ error: error.message || 'Connection error' })),
            );
            const reconnectAttempt$ = fromEvent<number>(ticketsBoardSocketInstance, 'reconnect_attempt').pipe(
              map((attempt) => ticketsBoardSocketReconnecting({ attempt })),
            );
            const reconnecting$ = fromEvent<number>(ticketsBoardSocketInstance, 'reconnecting').pipe(
              map((attempt) => ticketsBoardSocketReconnecting({ attempt })),
            );
            const reconnect$ = fromEvent(ticketsBoardSocketInstance, 'reconnect').pipe(
              map(() => ticketsBoardSocketReconnected()),
            );
            const reconnectError$ = fromEvent<Error>(ticketsBoardSocketInstance, 'reconnect_error').pipe(
              map((error) => ticketsBoardSocketReconnectError({ error: error.message || 'Reconnection error' })),
            );
            const reconnectFailed$ = fromEvent(ticketsBoardSocketInstance, 'reconnect_failed').pipe(
              map(() => {
                ticketsBoardSocketInstance = null;

                return ticketsBoardSocketReconnectFailed({ error: 'Reconnection failed after all attempts' });
              }),
            );
            const setClientSuccess$ = fromEvent<{ message: string; clientId: string }>(
              ticketsBoardSocketInstance,
              'setClientSuccess',
            ).pipe(
              map((data) => setTicketsBoardSocketClientSuccess({ message: data.message, clientId: data.clientId })),
            );
            const error$ = fromEvent<{ message: string }>(ticketsBoardSocketInstance, 'error').pipe(
              map((data) => ticketsBoardSocketError({ message: data.message })),
            );
            const ticketUpsert$ = fromEvent(ticketsBoardSocketInstance, TICKETS_BOARD_SOCKET_EVENTS.ticketUpsert).pipe(
              map((payload) => ticketBoardTicketUpsert({ ticket: payload as never })),
            );
            const ticketRemoved$ = fromEvent(
              ticketsBoardSocketInstance,
              TICKETS_BOARD_SOCKET_EVENTS.ticketRemoved,
            ).pipe(map((payload) => ticketBoardTicketRemoved(payload as { id: string; clientId: string })));
            const ticketComment$ = fromEvent(
              ticketsBoardSocketInstance,
              TICKETS_BOARD_SOCKET_EVENTS.ticketCommentCreated,
            ).pipe(map((payload) => ticketBoardCommentCreated({ comment: payload as never })));
            const ticketActivity$ = fromEvent(
              ticketsBoardSocketInstance,
              TICKETS_BOARD_SOCKET_EVENTS.ticketActivityCreated,
            ).pipe(map((payload) => ticketBoardActivityCreated({ activity: payload as never })));
            const automationUpsert$ = fromEvent(
              ticketsBoardSocketInstance,
              TICKETS_BOARD_SOCKET_EVENTS.ticketAutomationUpsert,
            ).pipe(map((payload) => ticketBoardAutomationUpsert({ config: payload as never })));
            const knowledgeRelationChanged$ = fromEvent(
              ticketsBoardSocketInstance,
              TICKETS_BOARD_SOCKET_EVENTS.knowledgeRelationChanged,
            ).pipe(
              map((payload) => payload as { clientId?: string; sourceType?: 'ticket' | 'page'; sourceId?: string }),
              filter(
                (payload): payload is { clientId: string; sourceType: 'ticket' | 'page'; sourceId: string } =>
                  typeof payload.clientId === 'string' &&
                  typeof payload.sourceId === 'string' &&
                  (payload.sourceType === 'ticket' || payload.sourceType === 'page'),
              ),
              map((payload) =>
                loadKnowledgeRelations({
                  clientId: payload.clientId,
                  sourceType: payload.sourceType,
                  sourceId: payload.sourceId,
                }),
              ),
            );
            const runUpsert$ = fromEvent(
              ticketsBoardSocketInstance,
              TICKETS_BOARD_SOCKET_EVENTS.ticketAutomationRunUpsert,
            ).pipe(map((payload) => ticketBoardAutomationRunUpsert({ run: payload as never })));
            const runStep$ = fromEvent(
              ticketsBoardSocketInstance,
              TICKETS_BOARD_SOCKET_EVENTS.ticketAutomationRunStepAppended,
            ).pipe(
              map((raw) => {
                const body = raw as { runId?: string; step?: unknown };

                if (!body?.runId || !body?.step) {
                  return null;
                }

                return ticketBoardAutomationRunStepAppended({
                  runId: body.runId,
                  step: body.step as never,
                });
              }),
              filter((a): a is ReturnType<typeof ticketBoardAutomationRunStepAppended> => a !== null),
            );

            return merge(
              connectSuccess$,
              connectError$,
              reconnectAttempt$,
              reconnecting$,
              reconnect$,
              reconnectError$,
              reconnectFailed$,
              setClientSuccess$,
              error$,
              ticketUpsert$,
              ticketRemoved$,
              ticketComment$,
              ticketActivity$,
              automationUpsert$,
              knowledgeRelationChanged$,
              runUpsert$,
              runStep$,
            ).pipe(
              catchError((error) => {
                ticketsBoardSocketInstance = null;

                return of(connectTicketsBoardSocketFailure({ error: error.message || 'Connection error' }));
              }),
            );
          }),
        );
      }),
    );
  },
  { functional: true },
);

export const disconnectTicketsBoardSocket$ = createEffect(
  (actions$ = inject(Actions)) => {
    return actions$.pipe(
      ofType(disconnectTicketsBoardSocket),
      map(() => {
        if (ticketsBoardSocketInstance) {
          ticketsBoardSocketInstance.disconnect();
          ticketsBoardSocketInstance = null;
        }

        return disconnectTicketsBoardSocketSuccess();
      }),
    );
  },
  { functional: true },
);

export const restoreTicketsBoardSocketClient$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store)) => {
    return actions$.pipe(
      ofType(connectTicketsBoardSocketSuccess, ticketsBoardSocketReconnected),
      withLatestFrom(
        store.select(selectTicketsBoardSocketSelectedClientId),
        store.select(selectTicketsBoardSocketSettingClient),
      ),
      switchMap(([, selectedClientId, settingClient]) => {
        if (settingClient || !selectedClientId) {
          return EMPTY;
        }

        return of(null).pipe(
          delay(100),
          tap(() => {
            const socket = getTicketsBoardSocketInstance();

            if (socket?.connected) {
              socket.emit('setClient', { clientId: selectedClientId });
            }
          }),
          switchMap(() => EMPTY),
        );
      }),
    );
  },
  { functional: true, dispatch: false },
);
