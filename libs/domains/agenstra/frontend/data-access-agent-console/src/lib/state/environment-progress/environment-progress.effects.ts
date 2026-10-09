import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { catchError, filter, groupBy, map, mergeMap, of, switchMap, withLatestFrom } from 'rxjs';

import { EnvironmentProgressService } from '../../services/environment-progress.service';
import { loadClientAgents } from '../agents/agents.actions';
import { selectAgentsCreating, selectAgentsEntities } from '../agents/agents.selectors';
import {
  forwardedEventReceived,
  remoteReconnected,
  setClientSuccess,
} from '../container-socket/container-socket.actions';
import { selectSelectedClientId } from '../container-socket/container-socket.selectors';

import {
  environmentProgressReceived,
  loadEnvironmentProgress,
  loadEnvironmentProgressFailure,
  loadEnvironmentProgressSuccess,
} from './environment-progress.actions';
import type { EnvironmentProgress } from './environment-progress.types';

/** Forwarded agent-manager event carrying environment create / update progress. */
export const ENVIRONMENT_PROGRESS_SOCKET_EVENT = 'environmentProgress';

function normalizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  if (error && typeof error === 'object' && 'message' in error) {
    return String(error.message);
  }

  return 'An unexpected error occurred';
}

function isEnvironmentProgress(value: unknown): value is EnvironmentProgress {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<EnvironmentProgress>;

  return (
    typeof candidate.operationId === 'string' &&
    typeof candidate.status === 'string' &&
    typeof candidate.progress === 'number'
  );
}

/** Extract progress from a forwarded `{ success, data, timestamp }` payload. */
export function extractEnvironmentProgress(payload: unknown): EnvironmentProgress | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const envelope = payload as { success?: unknown; data?: unknown };

  if (envelope.success !== true || !isEnvironmentProgress(envelope.data)) {
    return null;
  }

  return envelope.data;
}

export const loadEnvironmentProgress$ = createEffect(
  (actions$ = inject(Actions), service = inject(EnvironmentProgressService)) =>
    actions$.pipe(
      ofType(loadEnvironmentProgress),
      groupBy(({ clientId }) => clientId),
      mergeMap((requests$) =>
        requests$.pipe(
          switchMap(({ clientId }) =>
            service.listClientEnvironmentProgress(clientId).pipe(
              map((operations) => {
                if (!Array.isArray(operations)) {
                  throw new Error('Invalid environment progress response');
                }

                return loadEnvironmentProgressSuccess({ clientId, operations });
              }),
              catchError((error) => of(loadEnvironmentProgressFailure({ clientId, error: normalizeError(error) }))),
            ),
          ),
        ),
      ),
    ),
  { functional: true },
);

/** Load the current state once a workspace is selected (or reconnected) so the bar shows instantly. */
export const loadEnvironmentProgressOnClientSelected$ = createEffect(
  (actions$ = inject(Actions)) =>
    actions$.pipe(
      ofType(setClientSuccess, remoteReconnected),
      map(({ clientId }) => loadEnvironmentProgress({ clientId })),
    ),
  { functional: true },
);

/** Route forwarded `environmentProgress` events of the selected workspace into the slice. */
export const routeEnvironmentProgressEvents$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store)) =>
    actions$.pipe(
      ofType(forwardedEventReceived),
      filter(({ event }) => event === ENVIRONMENT_PROGRESS_SOCKET_EVENT),
      map(({ payload }) => extractEnvironmentProgress(payload)),
      filter((progress): progress is EnvironmentProgress => progress !== null),
      withLatestFrom(store.select(selectSelectedClientId)),
      filter(([, clientId]) => !!clientId),
      map(([progress, clientId]) => environmentProgressReceived({ clientId: clientId as string, progress })),
    ),
  { functional: true },
);

/**
 * Refresh the environment list when an environment created elsewhere (other session / user) finished provisioning.
 * Creates of the current session are appended by `createClientAgentSuccess` and therefore skipped.
 */
export const reloadAgentsOnEnvironmentCreated$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store)) =>
    actions$.pipe(
      ofType(environmentProgressReceived),
      filter(({ progress }) => progress.operation === 'create' && progress.status === 'completed'),
      withLatestFrom(store.select(selectAgentsEntities), store.select(selectAgentsCreating)),
      filter(([{ clientId, progress }, entities, creating]) => {
        if (creating[clientId]) {
          return false;
        }

        return !progress.agentId || !(entities[clientId] ?? []).some((agent) => agent.id === progress.agentId);
      }),
      map(([{ clientId }]) => loadClientAgents({ clientId })),
    ),
  { functional: true },
);
