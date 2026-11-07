import { HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import type { Action } from '@ngrx/store';
import {
  type Observable,
  EMPTY,
  catchError,
  concat,
  concatMap,
  defer,
  exhaustMap,
  expand,
  filter,
  map,
  mergeMap,
  of,
  switchMap,
  takeWhile,
  tap,
  timer,
} from 'rxjs';

import { AgentGraphsService } from '../../services/agent-graphs.service';

import {
  agentGraphRefreshPollFinished,
  expandAgentGraphNeighbors,
  expandAgentGraphNeighborsFailure,
  expandAgentGraphNeighborsSuccess,
  loadAgentGraphDocument,
  loadAgentGraphDocumentFailure,
  loadAgentGraphDocumentPageSuccess,
  loadAgentGraphDocumentSuccess,
  loadAgentGraphNodeDetail,
  loadAgentGraphNodeDetailFailure,
  loadAgentGraphNodeDetailSuccess,
  loadAgentGraphOverview,
  loadAgentGraphOverviewFailure,
  loadAgentGraphOverviewSuccess,
  loadAgentGraphReferences,
  loadAgentGraphReferencesFailure,
  loadAgentGraphReferencesSuccess,
  loadAgentGraphStatus,
  loadAgentGraphStatusFailure,
  loadAgentGraphStatusSuccess,
  loadGlobalAgentGraph,
  loadGlobalAgentGraphStatus,
  loadGlobalAgentGraphStatusFailure,
  loadGlobalAgentGraphStatusSuccess,
  loadWorkspaceAgentGraph,
  refreshAgentGraph,
  refreshAgentGraphFailure,
  refreshAgentGraphSuccess,
  refreshWorkspaceGraphSnapshot,
  refreshWorkspaceGraphSnapshotFailure,
  refreshWorkspaceGraphSnapshotSuccess,
  searchAgentGraph,
  searchAgentGraphFailure,
  searchAgentGraphSuccess,
} from './agent-graphs.actions';
import {
  AGENT_GRAPH_PAGE_SIZE,
  agentGraphDocumentKey,
  agentGraphNodeDetailKey,
  type AgentGraphDocument,
  type AgentGraphStatus,
} from './agent-graphs.types';

/** Status polling after a refresh: every 3 s for up to 2 min while the build runs. */
export const AGENT_GRAPH_STATUS_POLL_MS = 3_000;
export const AGENT_GRAPH_STATUS_POLL_MAX = 40;

function normalizeError(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    const message = error.error?.message;

    if (Array.isArray(message)) {
      return message.join('; ');
    }

    return message ?? error.message ?? String(error.status);
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'An unexpected error occurred';
}

/**
 * Loads a document: one request for a fixed `limit`, otherwise every page in turn (offset / limit batches of
 * {@link AGENT_GRAPH_PAGE_SIZE}, like the other paginated lists). The first page replaces the document, later pages
 * are appended; a new view cancels the remaining pages (`switchMap` in the callers).
 */
function loadDocumentPages(
  key: string,
  limit: number | undefined,
  fetchPage: (offset: number, limit: number) => Observable<AgentGraphDocument>,
): Observable<Action> {
  const pages$ =
    limit !== undefined
      ? fetchPage(0, limit)
      : fetchPage(0, AGENT_GRAPH_PAGE_SIZE).pipe(
          expand((page) =>
            page.nextOffset !== undefined && page.nextOffset !== null
              ? fetchPage(page.nextOffset, AGENT_GRAPH_PAGE_SIZE)
              : EMPTY,
          ),
        );

  return pages$.pipe(
    map((document, index) =>
      index === 0
        ? loadAgentGraphDocumentSuccess({ key, document })
        : loadAgentGraphDocumentPageSuccess({ key, document }),
    ),
    catchError((error) => of(loadAgentGraphDocumentFailure({ key, error: normalizeError(error) }))),
  );
}

export const loadAgentGraphDocument$ = createEffect(
  (actions$ = inject(Actions), service = inject(AgentGraphsService)) =>
    actions$.pipe(
      ofType(loadAgentGraphDocument),
      switchMap(({ clientId, agentId, layer, limit, types }) =>
        loadDocumentPages(
          agentGraphDocumentKey({ scope: 'environment', clientId, agentId, layer, limit }),
          limit,
          (offset, pageLimit) => service.getDocument(clientId, agentId, { layer, limit: pageLimit, offset, types }),
        ),
      ),
    ),
  { functional: true },
);

export const loadWorkspaceAgentGraph$ = createEffect(
  (actions$ = inject(Actions), service = inject(AgentGraphsService)) =>
    actions$.pipe(
      ofType(loadWorkspaceAgentGraph),
      switchMap(({ clientId, layer, limit }) =>
        loadDocumentPages(
          agentGraphDocumentKey({ scope: 'workspace', clientId, layer, limit }),
          limit,
          (offset, pageLimit) => service.getWorkspaceGraph(clientId, { layer, limit: pageLimit, offset }),
        ),
      ),
    ),
  { functional: true },
);

export const loadGlobalAgentGraph$ = createEffect(
  (actions$ = inject(Actions), service = inject(AgentGraphsService)) =>
    actions$.pipe(
      ofType(loadGlobalAgentGraph),
      switchMap(({ layer, limit }) =>
        loadDocumentPages(
          agentGraphDocumentKey({ scope: 'global', clientId: null, layer, limit }),
          limit,
          (offset, pageLimit) => service.getGlobalGraph({ layer, limit: pageLimit, offset }),
        ),
      ),
    ),
  { functional: true },
);

export const expandAgentGraphNeighbors$ = createEffect(
  (actions$ = inject(Actions), service = inject(AgentGraphsService)) =>
    actions$.pipe(
      ofType(expandAgentGraphNeighbors),
      mergeMap(({ clientId, agentId, layer, nodeId, depth, limit }) => {
        // Neighbors merge into whatever environment document of this layer is shown (any node limit).
        const key = agentGraphDocumentKey({ scope: 'environment', clientId, agentId, layer, limit });

        return service.getNeighbors(clientId, agentId, nodeId, { layer, depth: depth ?? 1 }).pipe(
          map((document) => expandAgentGraphNeighborsSuccess({ key, document })),
          catchError((error) => of(expandAgentGraphNeighborsFailure({ error: normalizeError(error) }))),
        );
      }),
    ),
  { functional: true },
);

export const loadAgentGraphStatus$ = createEffect(
  (actions$ = inject(Actions), service = inject(AgentGraphsService)) =>
    actions$.pipe(
      ofType(loadAgentGraphStatus),
      switchMap(({ clientId, agentId }) =>
        service.getStatus(clientId, agentId).pipe(
          map((status) => loadAgentGraphStatusSuccess({ clientId, agentId, status })),
          catchError((error) => of(loadAgentGraphStatusFailure({ clientId, agentId, error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const loadAgentGraphOverview$ = createEffect(
  (actions$ = inject(Actions), service = inject(AgentGraphsService)) =>
    actions$.pipe(
      ofType(loadAgentGraphOverview),
      switchMap(({ clientId, agentId }) =>
        service.getOverview(clientId, agentId).pipe(
          map((overview) => loadAgentGraphOverviewSuccess({ clientId, agentId, overview })),
          catchError((error) => of(loadAgentGraphOverviewFailure({ clientId, agentId, error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const refreshAgentGraph$ = createEffect(
  (actions$ = inject(Actions), service = inject(AgentGraphsService)) =>
    actions$.pipe(
      ofType(refreshAgentGraph),
      exhaustMap(({ clientId, agentId, layer, limit }) =>
        service.refresh(clientId, agentId).pipe(
          map((response) =>
            refreshAgentGraphSuccess({ clientId, agentId, layer, response, ...(limit ? { limit } : {}) }),
          ),
          catchError((error) => of(refreshAgentGraphFailure({ clientId, agentId, error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

/**
 * After a queued rebuild: polls the status every {@link AGENT_GRAPH_STATUS_POLL_MS} while it is `building` (at most
 * {@link AGENT_GRAPH_STATUS_POLL_MAX} times). A finished build reloads the document and the overview. A newer refresh
 * replaces a running poll.
 */
export const pollAgentGraphStatusAfterRefresh$ = createEffect(
  (actions$ = inject(Actions), service = inject(AgentGraphsService)) =>
    actions$.pipe(
      ofType(refreshAgentGraphSuccess),
      switchMap(({ clientId, agentId, layer, limit }) => {
        let lastStatus: AgentGraphStatus | null = null;
        const updates$: Observable<Action> = timer(AGENT_GRAPH_STATUS_POLL_MS, AGENT_GRAPH_STATUS_POLL_MS).pipe(
          takeWhile((tick) => tick < AGENT_GRAPH_STATUS_POLL_MAX),
          concatMap(() => service.getStatus(clientId, agentId).pipe(catchError(() => of(null)))),
          filter((status): status is AgentGraphStatus => status !== null),
          takeWhile((status) => status.status === 'building', true),
          tap((status) => (lastStatus = status)),
          map((status) => loadAgentGraphStatusSuccess({ clientId, agentId, status })),
        );
        const finish$ = defer((): Observable<Action> => {
          const status = lastStatus;
          const finished = agentGraphRefreshPollFinished({ clientId, agentId, status });

          return status && status.status !== 'building'
            ? of(
                finished,
                loadAgentGraphDocument({ clientId, agentId, layer, ...(limit ? { limit } : {}) }),
                loadAgentGraphOverview({ clientId, agentId }),
              )
            : of(finished);
        });

        return concat(updates$, finish$);
      }),
    ),
  { functional: true },
);

export const loadAgentGraphNodeDetail$ = createEffect(
  (actions$ = inject(Actions), service = inject(AgentGraphsService)) =>
    actions$.pipe(
      ofType(loadAgentGraphNodeDetail),
      switchMap(({ clientId, agentId, layer, nodeId }) => {
        const key = agentGraphNodeDetailKey(clientId, agentId, layer, nodeId);

        return service.getNode(clientId, agentId, nodeId, layer).pipe(
          map((detail) => loadAgentGraphNodeDetailSuccess({ key, clientId, agentId, layer, detail })),
          catchError((error) => of(loadAgentGraphNodeDetailFailure({ key, error: normalizeError(error) }))),
        );
      }),
    ),
  { functional: true },
);

export const searchAgentGraph$ = createEffect(
  (actions$ = inject(Actions), service = inject(AgentGraphsService)) =>
    actions$.pipe(
      ofType(searchAgentGraph),
      switchMap(({ clientId, agentId, query, layer, types, limit }) =>
        service.search(clientId, agentId, { query, layer, types, limit }).pipe(
          map((response) => searchAgentGraphSuccess({ response })),
          catchError((error) => of(searchAgentGraphFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const loadAgentGraphReferences$ = createEffect(
  (actions$ = inject(Actions), service = inject(AgentGraphsService)) =>
    actions$.pipe(
      ofType(loadAgentGraphReferences),
      switchMap(({ clientId, agentId, promptId, limit }) =>
        service.getReferences(clientId, agentId, { promptId, limit }).pipe(
          map((response) => loadAgentGraphReferencesSuccess({ clientId, agentId, response })),
          catchError((error) =>
            of(loadAgentGraphReferencesFailure({ clientId, agentId, error: normalizeError(error) })),
          ),
        ),
      ),
    ),
  { functional: true },
);

/** Rebuilds the workspace snapshot, then reloads the workspace graph of the shown layer. */
export const refreshWorkspaceGraphSnapshot$ = createEffect(
  (actions$ = inject(Actions), service = inject(AgentGraphsService)) =>
    actions$.pipe(
      ofType(refreshWorkspaceGraphSnapshot),
      exhaustMap(({ clientId, layer, limit }) =>
        service.refreshWorkspaceSnapshot(clientId).pipe(
          mergeMap((status): Action[] => [
            refreshWorkspaceGraphSnapshotSuccess({ clientId, status }),
            loadWorkspaceAgentGraph({ clientId, layer, ...(limit ? { limit } : {}) }),
          ]),
          catchError((error) => of(refreshWorkspaceGraphSnapshotFailure({ clientId, error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const loadGlobalAgentGraphStatus$ = createEffect(
  (actions$ = inject(Actions), service = inject(AgentGraphsService)) =>
    actions$.pipe(
      ofType(loadGlobalAgentGraphStatus),
      switchMap(() =>
        service.getGlobalStatus().pipe(
          map((statuses) => loadGlobalAgentGraphStatusSuccess({ statuses })),
          catchError((error) => of(loadGlobalAgentGraphStatusFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);
