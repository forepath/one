import { inject } from '@angular/core';
import type { Environment } from '@forepath/agenstra/frontend/util-configuration';
import { ENVIRONMENT, resolveApiWebsocketUrl } from '@forepath/agenstra/frontend/util-configuration';
import { OidcAuthService, resolveAuthorizationHeader$ } from '@forepath/identity/frontend';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { catchError, delay, EMPTY, filter, fromEvent, map, merge, of, switchMap, tap, withLatestFrom } from 'rxjs';
import { io, Socket } from 'socket.io-client';

import {
  initiativeActivityLiveCreated,
  initiativeArtifactLiveRemoved,
  initiativeArtifactLiveUpsert,
  initiativeDecisionLiveUpsert,
  initiativeFindingLiveUpsert,
  initiativeLiveRemoved,
  initiativeLiveUpsert,
  initiativeProposalLiveUpsert,
  initiativeRunLiveUpsert,
  initiativeRunTurnLiveAppended,
  initiativeWorkItemsLiveChanged,
} from '../initiatives/initiatives.actions';
import type {
  InitiativeActivityDto,
  InitiativeArtifactDto,
  InitiativeDecisionDto,
  InitiativeDto,
  InitiativeFindingDto,
  InitiativeProposalDto,
  InitiativeRunDto,
  InitiativeRunTurnDto,
  InitiativeWorkItemsDto,
} from '../initiatives/initiatives.types';

import {
  connectInitiativesBoardSocket,
  connectInitiativesBoardSocketFailure,
  connectInitiativesBoardSocketSuccess,
  disconnectInitiativesBoardSocket,
  disconnectInitiativesBoardSocketSuccess,
  initiativesBoardSocketError,
  initiativesBoardSocketReconnected,
  initiativesBoardSocketReconnectError,
  initiativesBoardSocketReconnectFailed,
  initiativesBoardSocketReconnecting,
  setInitiativesBoardSocketClientSuccess,
} from './initiatives-board-socket.actions';
import { INITIATIVES_BOARD_SOCKET_EVENTS } from './initiatives-board-socket.constants';
import {
  selectInitiativesBoardSocketSelectedClientId,
  selectInitiativesBoardSocketSettingClient,
} from './initiatives-board-socket.selectors';

/** Payloads arrive from the server; only well-formed ones (with an id) reach the store. */
function hasId(payload: unknown): payload is { id: string } {
  return !!payload && typeof payload === 'object' && typeof (payload as { id?: unknown }).id === 'string';
}

export function resolveInitiativesBoardWebsocketUrl(environment: Environment): string | null {
  const base = resolveApiWebsocketUrl(environment.console.urls.websocket, 'default');

  if (!base) {
    return null;
  }

  if (base.endsWith('/clients')) {
    return `${base.slice(0, -'/clients'.length)}/initiatives`;
  }

  try {
    const u = new URL(base);

    return `${u.protocol}//${u.host}/socket/initiatives`;
  } catch {
    return `${base.replace(/\/$/, '')}/socket/initiatives`;
  }
}

let initiativesBoardSocketInstance: Socket | null = null;

export function getInitiativesBoardSocketInstance(): Socket | null {
  return initiativesBoardSocketInstance;
}

export const connectInitiativesBoardSocket$ = createEffect(
  (
    actions$ = inject(Actions),
    environment = inject<Environment>(ENVIRONMENT),
    oidcAuthService = inject(OidcAuthService),
  ) =>
    actions$.pipe(
      ofType(connectInitiativesBoardSocket),
      switchMap(() => {
        const websocketUrl = resolveInitiativesBoardWebsocketUrl(environment);

        if (!websocketUrl) {
          return of(connectInitiativesBoardSocketFailure({ error: 'Initiatives WebSocket URL not configured' }));
        }

        if (initiativesBoardSocketInstance) {
          initiativesBoardSocketInstance.disconnect();
          initiativesBoardSocketInstance = null;
        }

        return resolveAuthorizationHeader$(environment.authentication.config, oidcAuthService).pipe(
          switchMap((authHeader) => {
            initiativesBoardSocketInstance = io(websocketUrl, {
              transports: ['websocket'],
              rejectUnauthorized: false,
              reconnection: true,
              reconnectionAttempts: 5,
              reconnectionDelay: 1000,
              reconnectionDelayMax: 5000,
              randomizationFactor: 0.5,
              ...(authHeader && { auth: { Authorization: authHeader } }),
            });

            const connectSuccess$ = fromEvent(initiativesBoardSocketInstance, 'connect').pipe(
              map(() => connectInitiativesBoardSocketSuccess()),
            );
            const connectError$ = fromEvent<Error>(initiativesBoardSocketInstance, 'connect_error').pipe(
              map((error) => initiativesBoardSocketReconnectError({ error: error.message || 'Connection error' })),
            );
            const reconnecting$ = fromEvent<number>(initiativesBoardSocketInstance, 'reconnecting').pipe(
              map((attempt) => initiativesBoardSocketReconnecting({ attempt })),
            );
            const reconnect$ = fromEvent(initiativesBoardSocketInstance, 'reconnect').pipe(
              map(() => initiativesBoardSocketReconnected()),
            );
            const reconnectError$ = fromEvent<Error>(initiativesBoardSocketInstance, 'reconnect_error').pipe(
              map((error) => initiativesBoardSocketReconnectError({ error: error.message || 'Reconnection error' })),
            );
            const reconnectFailed$ = fromEvent(initiativesBoardSocketInstance, 'reconnect_failed').pipe(
              map(() => {
                initiativesBoardSocketInstance = null;

                return initiativesBoardSocketReconnectFailed({ error: 'Reconnection failed after all attempts' });
              }),
            );
            const setClientSuccess$ = fromEvent<{ message: string; clientId: string }>(
              initiativesBoardSocketInstance,
              'setClientSuccess',
            ).pipe(
              map((data) => setInitiativesBoardSocketClientSuccess({ message: data.message, clientId: data.clientId })),
            );
            const error$ = fromEvent<{ message: string }>(initiativesBoardSocketInstance, 'error').pipe(
              map((data) => initiativesBoardSocketError({ message: data.message })),
            );
            const socket = initiativesBoardSocketInstance;
            const on = <T>(event: string) =>
              fromEvent<unknown>(socket, event).pipe(
                filter(hasId),
                map((payload) => payload as unknown as T),
              );
            const live$ = merge(
              on<InitiativeDto>(INITIATIVES_BOARD_SOCKET_EVENTS.initiativeUpsert).pipe(
                map((initiative) => initiativeLiveUpsert({ initiative })),
              ),
              on<{ id: string }>(INITIATIVES_BOARD_SOCKET_EVENTS.initiativeRemoved).pipe(
                map(({ id }) => initiativeLiveRemoved({ id })),
              ),
              on<InitiativeArtifactDto>(INITIATIVES_BOARD_SOCKET_EVENTS.initiativeArtifactUpsert).pipe(
                map((artifact) => initiativeArtifactLiveUpsert({ artifact })),
              ),
              on<{ id: string; initiativeId: string }>(INITIATIVES_BOARD_SOCKET_EVENTS.initiativeArtifactRemoved).pipe(
                map(({ id, initiativeId }) => initiativeArtifactLiveRemoved({ id, initiativeId })),
              ),
              fromEvent<unknown>(socket, INITIATIVES_BOARD_SOCKET_EVENTS.initiativeWorkItemsChanged).pipe(
                map((payload) => payload as { initiativeId?: string } & Partial<InitiativeWorkItemsDto>),
                filter(
                  (payload): payload is { initiativeId: string } & InitiativeWorkItemsDto =>
                    typeof payload?.initiativeId === 'string' && Array.isArray(payload.items),
                ),
                map(({ initiativeId, items, initiativeVersion, unknowns }) =>
                  initiativeWorkItemsLiveChanged({
                    initiativeId,
                    workItems: { initiativeId, items, initiativeVersion, unknowns: unknowns ?? [] },
                  }),
                ),
              ),
              on<InitiativeRunDto>(INITIATIVES_BOARD_SOCKET_EVENTS.initiativeRunUpsert).pipe(
                map((run) => initiativeRunLiveUpsert({ run })),
              ),
              on<InitiativeRunTurnDto & { initiativeId: string }>(
                INITIATIVES_BOARD_SOCKET_EVENTS.initiativeRunTurnAppended,
              ).pipe(map(({ initiativeId, ...turn }) => initiativeRunTurnLiveAppended({ initiativeId, turn }))),
              on<InitiativeProposalDto>(INITIATIVES_BOARD_SOCKET_EVENTS.initiativeProposalUpsert).pipe(
                map((proposal) => initiativeProposalLiveUpsert({ proposal })),
              ),
              on<InitiativeFindingDto>(INITIATIVES_BOARD_SOCKET_EVENTS.initiativeFindingUpsert).pipe(
                map((finding) => initiativeFindingLiveUpsert({ finding })),
              ),
              on<InitiativeDecisionDto>(INITIATIVES_BOARD_SOCKET_EVENTS.initiativeDecisionUpsert).pipe(
                map((decision) => initiativeDecisionLiveUpsert({ decision })),
              ),
              on<InitiativeActivityDto>(INITIATIVES_BOARD_SOCKET_EVENTS.initiativeActivityCreated).pipe(
                map((activity) => initiativeActivityLiveCreated({ activity })),
              ),
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
              live$,
            ).pipe(
              catchError((error) => {
                initiativesBoardSocketInstance = null;

                return of(connectInitiativesBoardSocketFailure({ error: error.message || 'Connection error' }));
              }),
            );
          }),
        );
      }),
    ),
  { functional: true },
);

export const disconnectInitiativesBoardSocket$ = createEffect(
  (actions$ = inject(Actions)) =>
    actions$.pipe(
      ofType(disconnectInitiativesBoardSocket),
      map(() => {
        if (initiativesBoardSocketInstance) {
          initiativesBoardSocketInstance.disconnect();
          initiativesBoardSocketInstance = null;
        }

        return disconnectInitiativesBoardSocketSuccess();
      }),
    ),
  { functional: true },
);

export const restoreInitiativesBoardSocketClient$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store)) =>
    actions$.pipe(
      ofType(connectInitiativesBoardSocketSuccess, initiativesBoardSocketReconnected),
      withLatestFrom(
        store.select(selectInitiativesBoardSocketSelectedClientId),
        store.select(selectInitiativesBoardSocketSettingClient),
      ),
      switchMap(([, selectedClientId, settingClient]) => {
        if (settingClient || !selectedClientId) {
          return EMPTY;
        }

        return of(null).pipe(
          delay(100),
          tap(() => {
            const socket = getInitiativesBoardSocketInstance();

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
