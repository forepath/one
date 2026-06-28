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

import { resolveBillingTenantId } from '../../interceptors/tenant.interceptor';
import { projectSummaryChanged } from '../projects/projects.actions';
import {
  projectBoardMilestoneRemoved,
  projectBoardMilestoneUpsert,
} from '../project-milestones/project-milestones.actions';
import {
  projectBoardActivityCreated,
  projectBoardCommentCreated,
  projectBoardTicketRemoved,
  projectBoardTicketUpsert,
} from '../project-tickets/project-tickets.actions';
import {
  projectBoardTimeEntryRemoved,
  projectBoardTimeEntryUpsert,
} from '../project-time-entries/project-time-entries.actions';

import {
  connectProjectBoardSocket,
  connectProjectBoardSocketFailure,
  connectProjectBoardSocketSuccess,
  disconnectProjectBoardSocket,
  disconnectProjectBoardSocketSuccess,
  projectBoardSocketError,
  projectBoardSocketReconnected,
  projectBoardSocketReconnecting,
  setProjectBoardSocketProjectSuccess,
} from './project-board-socket.actions';
import { PROJECT_BOARD_SOCKET_EVENTS } from './project-board-socket.constants';
import { selectProjectBoardSocketSelectedProjectId } from './project-board-socket.selectors';

const API_KEY_STORAGE_KEY = 'agent-controller-api-key';
const USERS_JWT_STORAGE_KEY = 'agent-controller-users-jwt';

export function resolveProjectBoardWebsocketUrl(environment: Environment): string | null {
  const explicit = environment.billing.projectsWebsocketUrl?.trim();

  if (explicit) return explicit;

  const base = environment.billing.websocketUrl?.trim();

  if (!base) return null;

  try {
    const u = new URL(base);

    return `${u.protocol}//${u.host}/projects`;
  } catch {
    return `${base.replace(/\/$/, '').replace(/\/billing$/, '')}/projects`;
  }
}

function getAuthHeader(environment: Environment, keycloakService: KeycloakService | null): Observable<string | null> {
  if (environment.authentication.type === 'api-key') {
    const apiKey =
      environment.authentication.apiKey ??
      (typeof localStorage !== 'undefined' ? localStorage.getItem(API_KEY_STORAGE_KEY) : null);

    return apiKey ? of(`Bearer ${apiKey}`) : of(null);
  }

  if (environment.authentication.type === 'keycloak' && keycloakService) {
    return from(keycloakService.getToken()).pipe(
      map((token) => (token ? `Bearer ${token}` : null)),
      catchError(() => of(null)),
    );
  }

  if (environment.authentication.type === 'users') {
    const jwt = typeof localStorage !== 'undefined' ? localStorage.getItem(USERS_JWT_STORAGE_KEY) : null;

    return jwt ? of(`Bearer ${jwt}`) : of(null);
  }

  return of(null);
}

let projectBoardSocketInstance: Socket | null = null;

export function getProjectBoardSocketInstance(): Socket | null {
  return projectBoardSocketInstance;
}

export const connectProjectBoardSocket$ = createEffect(
  (
    actions$ = inject(Actions),
    environment = inject<Environment>(ENVIRONMENT),
    keycloakService = inject(KeycloakService, { optional: true }),
  ) =>
    actions$.pipe(
      ofType(connectProjectBoardSocket),
      switchMap(() => {
        const websocketUrl = resolveProjectBoardWebsocketUrl(environment);

        if (!websocketUrl) {
          return of(connectProjectBoardSocketFailure({ error: 'Projects WebSocket URL not configured' }));
        }

        if (projectBoardSocketInstance?.connected) {
          return of(connectProjectBoardSocketSuccess());
        }

        if (projectBoardSocketInstance) {
          projectBoardSocketInstance.disconnect();
          projectBoardSocketInstance = null;
        }

        return getAuthHeader(environment, keycloakService).pipe(
          switchMap((authHeader) => {
            if (!authHeader) {
              return of(connectProjectBoardSocketFailure({ error: 'Not authenticated for WebSocket' }));
            }

            projectBoardSocketInstance = io(websocketUrl, {
              transports: ['websocket'],
              rejectUnauthorized: false,
              reconnection: true,
              reconnectionAttempts: 5,
              reconnectionDelay: 1000,
              extraHeaders: { 'X-Tenant': resolveBillingTenantId(environment) },
              auth: {
                Authorization: authHeader,
                tenantId: resolveBillingTenantId(environment),
              },
            });

            const socket = projectBoardSocketInstance;
            const connectSuccess$ = fromEvent(socket, 'connect').pipe(map(() => connectProjectBoardSocketSuccess()));
            const connectError$ = fromEvent<Error>(socket, 'connect_error').pipe(
              map((error) => connectProjectBoardSocketFailure({ error: error.message || 'Connection error' })),
            );
            const reconnecting$ = fromEvent<number>(socket, 'reconnect_attempt').pipe(
              map((attempt) => projectBoardSocketReconnecting({ attempt })),
            );
            const reconnected$ = fromEvent(socket, 'reconnect').pipe(map(() => projectBoardSocketReconnected()));
            const setProjectSuccess$ = fromEvent<{ message: string; projectId: string }>(
              socket,
              'setProjectSuccess',
            ).pipe(map((data) => setProjectBoardSocketProjectSuccess(data)));
            const error$ = fromEvent<{ message: string }>(socket, 'error').pipe(
              map((data) => projectBoardSocketError({ message: data.message })),
            );
            const ticketUpsert$ = fromEvent(socket, PROJECT_BOARD_SOCKET_EVENTS.ticketUpsert).pipe(
              map((payload) => projectBoardTicketUpsert({ ticket: payload as never })),
            );
            const ticketRemoved$ = fromEvent(socket, PROJECT_BOARD_SOCKET_EVENTS.ticketRemoved).pipe(
              map((payload) => projectBoardTicketRemoved(payload as { id: string; projectId: string })),
            );
            const comment$ = fromEvent(socket, PROJECT_BOARD_SOCKET_EVENTS.ticketCommentCreated).pipe(
              map((payload) => projectBoardCommentCreated({ comment: payload as never })),
            );
            const activity$ = fromEvent(socket, PROJECT_BOARD_SOCKET_EVENTS.ticketActivityCreated).pipe(
              map((payload) => projectBoardActivityCreated({ activity: payload as never })),
            );
            const milestoneUpsert$ = fromEvent(socket, PROJECT_BOARD_SOCKET_EVENTS.milestoneUpsert).pipe(
              map((payload) => projectBoardMilestoneUpsert({ milestone: payload as never })),
            );
            const milestoneRemoved$ = fromEvent(socket, PROJECT_BOARD_SOCKET_EVENTS.milestoneRemoved).pipe(
              map((payload) => projectBoardMilestoneRemoved(payload as { id: string; projectId: string })),
            );
            const timeEntryUpsert$ = fromEvent(socket, PROJECT_BOARD_SOCKET_EVENTS.timeEntryUpsert).pipe(
              map((payload) => projectBoardTimeEntryUpsert({ entry: payload as never })),
            );
            const timeEntryRemoved$ = fromEvent(socket, PROJECT_BOARD_SOCKET_EVENTS.timeEntryRemoved).pipe(
              map((payload) => projectBoardTimeEntryRemoved(payload as { id: string; projectId: string })),
            );
            const summaryChanged$ = fromEvent(socket, PROJECT_BOARD_SOCKET_EVENTS.projectSummaryChanged).pipe(
              map((payload) => projectSummaryChanged({ summary: payload as never })),
            );

            return merge(
              connectSuccess$,
              connectError$,
              reconnecting$,
              reconnected$,
              setProjectSuccess$,
              error$,
              ticketUpsert$,
              ticketRemoved$,
              comment$,
              activity$,
              milestoneUpsert$,
              milestoneRemoved$,
              timeEntryUpsert$,
              timeEntryRemoved$,
              summaryChanged$,
            ).pipe(
              catchError((error) => {
                projectBoardSocketInstance = null;

                return of(connectProjectBoardSocketFailure({ error: error.message || 'Connection error' }));
              }),
            );
          }),
        );
      }),
    ),
  { functional: true },
);

export const disconnectProjectBoardSocket$ = createEffect(
  (actions$ = inject(Actions)) =>
    actions$.pipe(
      ofType(disconnectProjectBoardSocket),
      tap(() => {
        if (projectBoardSocketInstance) {
          projectBoardSocketInstance.disconnect();
          projectBoardSocketInstance = null;
        }
      }),
      map(() => disconnectProjectBoardSocketSuccess()),
    ),
  { functional: true },
);

export const restoreProjectBoardSocketProject$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store)) =>
    actions$.pipe(
      ofType(connectProjectBoardSocketSuccess, projectBoardSocketReconnected),
      withLatestFrom(store.select(selectProjectBoardSocketSelectedProjectId)),
      switchMap(([, selectedProjectId]) => {
        if (!selectedProjectId) return EMPTY;

        return of(null).pipe(
          delay(100),
          tap(() => {
            const socket = getProjectBoardSocketInstance();

            if (socket?.connected) {
              socket.emit('setProject', { projectId: selectedProjectId });
            }
          }),
          switchMap(() => EMPTY),
        );
      }),
    ),
  { functional: true, dispatch: false },
);
