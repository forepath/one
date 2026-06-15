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

import { loadKnowledgeRelations, loadKnowledgeTree, prependKnowledgeActivity } from '../knowledge/knowledge.actions';
import type { KnowledgeActionType } from '../knowledge/knowledge.types';

import {
  connectKnowledgeBoardSocket,
  connectKnowledgeBoardSocketFailure,
  connectKnowledgeBoardSocketSuccess,
  disconnectKnowledgeBoardSocket,
  disconnectKnowledgeBoardSocketSuccess,
  knowledgeBoardSocketError,
  knowledgeBoardSocketReconnected,
  knowledgeBoardSocketReconnectError,
  knowledgeBoardSocketReconnectFailed,
  knowledgeBoardSocketReconnecting,
  setKnowledgeBoardSocketClientSuccess,
} from './knowledge-board-socket.actions';
import { KNOWLEDGE_BOARD_SOCKET_EVENTS } from './knowledge-board-socket.constants';
import {
  selectKnowledgeBoardSocketSelectedClientId,
  selectKnowledgeBoardSocketSettingClient,
} from './knowledge-board-socket.selectors';

const API_KEY_STORAGE_KEY = 'agent-controller-api-key';
const USERS_JWT_STORAGE_KEY = 'agent-controller-users-jwt';
const KNOWLEDGE_ACTION_TYPES: ReadonlySet<KnowledgeActionType> = new Set<KnowledgeActionType>([
  'CREATED',
  'FIELD_UPDATED',
  'CONTENT_UPDATED',
  'PARENT_CHANGED',
  'SORT_ORDER_CHANGED',
  'DELETED',
  'DUPLICATED',
  'RELATION_ADDED',
  'RELATION_REMOVED',
]);

export function resolveKnowledgeBoardWebsocketUrl(environment: Environment): string | null {
  const base = environment.controller.websocketUrl?.trim();

  if (!base) {
    return null;
  }

  if (base.endsWith('/clients')) {
    return `${base.slice(0, -'/clients'.length)}/pages`;
  }

  try {
    const u = new URL(base);

    return `${u.protocol}//${u.host}/pages`;
  } catch {
    return `${base.replace(/\/$/, '')}/pages`;
  }
}

function getAuthHeader(environment: Environment, keycloakService: KeycloakService | null): Observable<string | null> {
  if (environment.authentication.type === 'api-key') {
    const apiKey =
      environment.authentication.apiKey ??
      (typeof localStorage !== 'undefined' ? localStorage.getItem(API_KEY_STORAGE_KEY) : null);

    return of(apiKey ? `Bearer ${apiKey}` : null);
  }

  if (environment.authentication.type === 'keycloak' && keycloakService) {
    return from(keycloakService.getToken()).pipe(
      map((token) => (token ? `Bearer ${token}` : null)),
      catchError(() => of(null)),
    );
  }

  if (environment.authentication.type === 'users') {
    const jwt = typeof localStorage !== 'undefined' ? localStorage.getItem(USERS_JWT_STORAGE_KEY) : null;

    return of(jwt ? `Bearer ${jwt}` : null);
  }

  return of(null);
}

let knowledgeBoardSocketInstance: Socket | null = null;

export function getKnowledgeBoardSocketInstance(): Socket | null {
  return knowledgeBoardSocketInstance;
}

export const connectKnowledgeBoardSocket$ = createEffect(
  (
    actions$ = inject(Actions),
    environment = inject<Environment>(ENVIRONMENT),
    keycloakService = inject(KeycloakService, { optional: true }),
  ) =>
    actions$.pipe(
      ofType(connectKnowledgeBoardSocket),
      switchMap(() => {
        const websocketUrl = resolveKnowledgeBoardWebsocketUrl(environment);

        if (!websocketUrl) {
          return of(connectKnowledgeBoardSocketFailure({ error: 'Knowledge WebSocket URL not configured' }));
        }

        if (knowledgeBoardSocketInstance) {
          knowledgeBoardSocketInstance.disconnect();
          knowledgeBoardSocketInstance = null;
        }

        return getAuthHeader(environment, keycloakService).pipe(
          switchMap((authHeader) => {
            knowledgeBoardSocketInstance = io(websocketUrl, {
              transports: ['websocket'],
              rejectUnauthorized: false,
              reconnection: true,
              reconnectionAttempts: 5,
              reconnectionDelay: 1000,
              reconnectionDelayMax: 5000,
              randomizationFactor: 0.5,
              ...(authHeader && { auth: { Authorization: authHeader } }),
            });

            const connectSuccess$ = fromEvent(knowledgeBoardSocketInstance, 'connect').pipe(
              map(() => connectKnowledgeBoardSocketSuccess()),
            );
            const connectError$ = fromEvent<Error>(knowledgeBoardSocketInstance, 'connect_error').pipe(
              map((error) => knowledgeBoardSocketReconnectError({ error: error.message || 'Connection error' })),
            );
            const reconnecting$ = fromEvent<number>(knowledgeBoardSocketInstance, 'reconnecting').pipe(
              map((attempt) => knowledgeBoardSocketReconnecting({ attempt })),
            );
            const reconnect$ = fromEvent(knowledgeBoardSocketInstance, 'reconnect').pipe(
              map(() => knowledgeBoardSocketReconnected()),
            );
            const reconnectError$ = fromEvent<Error>(knowledgeBoardSocketInstance, 'reconnect_error').pipe(
              map((error) => knowledgeBoardSocketReconnectError({ error: error.message || 'Reconnection error' })),
            );
            const reconnectFailed$ = fromEvent(knowledgeBoardSocketInstance, 'reconnect_failed').pipe(
              map(() => {
                knowledgeBoardSocketInstance = null;

                return knowledgeBoardSocketReconnectFailed({ error: 'Reconnection failed after all attempts' });
              }),
            );
            const setClientSuccess$ = fromEvent<{ message: string; clientId: string }>(
              knowledgeBoardSocketInstance,
              'setClientSuccess',
            ).pipe(
              map((data) => setKnowledgeBoardSocketClientSuccess({ message: data.message, clientId: data.clientId })),
            );
            const error$ = fromEvent<{ message: string }>(knowledgeBoardSocketInstance, 'error').pipe(
              map((data) => knowledgeBoardSocketError({ message: data.message })),
            );
            const treeChanged$ = fromEvent<{ clientId?: string }>(
              knowledgeBoardSocketInstance,
              KNOWLEDGE_BOARD_SOCKET_EVENTS.knowledgeTreeChanged,
            ).pipe(
              filter((payload): payload is { clientId: string } => typeof payload.clientId === 'string'),
              map((payload) => loadKnowledgeTree({ clientId: payload.clientId })),
            );
            const relationChanged$ = fromEvent(
              knowledgeBoardSocketInstance,
              KNOWLEDGE_BOARD_SOCKET_EVENTS.knowledgeRelationChanged,
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
            const pageActivityCreated$ = fromEvent(
              knowledgeBoardSocketInstance,
              KNOWLEDGE_BOARD_SOCKET_EVENTS.knowledgePageActivityCreated,
            ).pipe(
              map(
                (payload) =>
                  payload as {
                    id?: string;
                    pageId?: string;
                    occurredAt?: string;
                    actorType?: 'human' | 'ai' | 'system';
                    actorUserId?: string | null;
                    actorEmail?: string | null;
                    actionType?: string;
                    payload?: Record<string, unknown>;
                  },
              ),
              filter(
                (
                  activity,
                ): activity is {
                  id: string;
                  pageId: string;
                  occurredAt: string;
                  actorType: 'human' | 'ai' | 'system';
                  actorUserId?: string | null;
                  actorEmail?: string | null;
                  actionType: KnowledgeActionType;
                  payload: Record<string, unknown>;
                } =>
                  typeof activity.id === 'string' &&
                  typeof activity.pageId === 'string' &&
                  typeof activity.occurredAt === 'string' &&
                  (activity.actorType === 'human' || activity.actorType === 'ai' || activity.actorType === 'system') &&
                  typeof activity.actionType === 'string' &&
                  KNOWLEDGE_ACTION_TYPES.has(activity.actionType as KnowledgeActionType) &&
                  activity.payload !== null &&
                  typeof activity.payload === 'object',
              ),
              map((activity) => prependKnowledgeActivity({ activity })),
            );

            return merge(
              connectSuccess$,
              connectError$,
              reconnecting$,
              reconnect$,
              reconnectError$,
              reconnectFailed$,
              setClientSuccess$,
              error$,
              treeChanged$,
              relationChanged$,
              pageActivityCreated$,
            ).pipe(
              catchError((error) => {
                knowledgeBoardSocketInstance = null;

                return of(connectKnowledgeBoardSocketFailure({ error: error.message || 'Connection error' }));
              }),
            );
          }),
        );
      }),
    ),
  { functional: true },
);

export const disconnectKnowledgeBoardSocket$ = createEffect(
  (actions$ = inject(Actions)) =>
    actions$.pipe(
      ofType(disconnectKnowledgeBoardSocket),
      map(() => {
        if (knowledgeBoardSocketInstance) {
          knowledgeBoardSocketInstance.disconnect();
          knowledgeBoardSocketInstance = null;
        }

        return disconnectKnowledgeBoardSocketSuccess();
      }),
    ),
  { functional: true },
);

export const restoreKnowledgeBoardSocketClient$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store)) =>
    actions$.pipe(
      ofType(connectKnowledgeBoardSocketSuccess, knowledgeBoardSocketReconnected),
      withLatestFrom(
        store.select(selectKnowledgeBoardSocketSelectedClientId),
        store.select(selectKnowledgeBoardSocketSettingClient),
      ),
      switchMap(([, selectedClientId, settingClient]) => {
        if (settingClient || !selectedClientId) {
          return EMPTY;
        }

        return of(null).pipe(
          delay(100),
          tap(() => {
            const socket = getKnowledgeBoardSocketInstance();

            if (socket?.connected) {
              socket.emit('setClient', { clientId: selectedClientId });
            }
          }),
          switchMap(() => EMPTY),
        );
      }),
    ),
  { functional: true, dispatch: false },
);
