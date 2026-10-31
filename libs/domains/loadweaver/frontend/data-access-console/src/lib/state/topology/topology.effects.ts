import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store, type Action } from '@ngrx/store';
import { catchError, from, map, Observable, of, switchMap, takeUntil, withLatestFrom } from 'rxjs';

import { TopologyService } from '../../services/topology.service';
import { ConsoleSocketService } from '../../sockets/console-socket';
import type { TopologyFlowsEvent } from '../../types/topology.types';
import { apiErrorMessage } from '../../utils/api-error';
import { selectTopologyQuery } from './topology.selectors';
import {
  connectTopologyLive,
  disconnectTopologyLive,
  loadTopology,
  loadTopologyFailure,
  loadTopologySuccess,
  topologyFlowsReceived,
  topologyLiveConnected,
  topologyLiveError,
  topologyStructureChanged,
  traceTopology,
  traceTopologyFailure,
  traceTopologySuccess,
} from './topology.actions';

export const loadTopology$ = createEffect(
  (actions$ = inject(Actions), service = inject(TopologyService)) =>
    actions$.pipe(
      ofType(loadTopology),
      switchMap(({ query }) =>
        service.graph(query).pipe(
          map((graph) => loadTopologySuccess({ graph })),
          catchError((error: unknown) =>
            of(loadTopologyFailure({ error: apiErrorMessage(error, 'Failed to load the map') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const traceTopology$ = createEffect(
  (actions$ = inject(Actions), service = inject(TopologyService)) =>
    actions$.pipe(
      ofType(traceTopology),
      switchMap(({ host }) =>
        service.trace(host).pipe(
          map((trace) => traceTopologySuccess({ host, trace })),
          catchError((error: unknown) =>
            of(traceTopologyFailure({ host, error: apiErrorMessage(error, 'Failed to trace the hostname') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

/**
 * `socket/topology`: `subscribe { structure: true }` after connecting (again after a reconnect), then `flows` every
 * 10 s (cluster roles) and `structureChanged` when the map's structure changes (3.36 B3); `error` on too many
 * subscriptions. `unsubscribe` and close when the live map is left.
 */
export const topologyLive$ = createEffect(
  (actions$ = inject(Actions), sockets = inject(ConsoleSocketService)) =>
    actions$.pipe(
      ofType(connectTopologyLive),
      switchMap(() =>
        from(sockets.open('topology')).pipe(
          switchMap((socket) =>
            socket
              ? new Observable<Action>((subscriber) => {
                  socket.on('connect', () => {
                    // Structure changes for everyone (3.36 B3); flows only reach cluster roles.
                    socket.emit('subscribe', { structure: true });
                    subscriber.next(topologyLiveConnected({ connected: true }));
                  });
                  socket.on('disconnect', () => subscriber.next(topologyLiveConnected({ connected: false })));
                  socket.on('flows', (event: TopologyFlowsEvent) => {
                    if (event?.at && Array.isArray(event.edges))
                      subscriber.next(topologyFlowsReceived({ at: event.at, edges: event.edges }));
                  });
                  socket.on('structureChanged', (event: { version?: string } | undefined) => {
                    if (event?.version) subscriber.next(topologyStructureChanged({ version: event.version }));
                  });
                  socket.on('error', (event: { message?: string } | undefined) =>
                    subscriber.next(topologyLiveError({ error: event?.message ?? 'Live traffic failed' })),
                  );
                  socket.on('connect_error', (error: Error) =>
                    subscriber.next(topologyLiveError({ error: error?.message || 'Live traffic failed' })),
                  );

                  return () => {
                    if (socket.connected) socket.emit('unsubscribe');

                    socket.removeAllListeners();
                    socket.disconnect();
                  };
                })
              : of(topologyLiveConnected({ connected: false })),
          ),
          catchError(() => of(topologyLiveConnected({ connected: false }))),
          takeUntil(actions$.pipe(ofType(disconnectTopologyLive))),
        ),
      ),
    ),
  { functional: true },
);

/** A new structure (3.36 B3) reloads the current map quietly — replaces the console's 60 s re-poll while live. */
export const reloadTopologyOnStructureChange$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store)) =>
    actions$.pipe(
      ofType(topologyStructureChanged),
      withLatestFrom(store.select(selectTopologyQuery)),
      map(([, query]) => loadTopology({ query, silent: true })),
    ),
  { functional: true },
);
