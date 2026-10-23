import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import type { Action } from '@ngrx/store';
import { catchError, from, map, Observable, of, switchMap, takeUntil } from 'rxjs';

import { TopologyService } from '../../services/topology.service';
import { ConsoleSocketService } from '../../sockets/console-socket';
import type { TopologyFlowsEvent } from '../../types/topology.types';
import { apiErrorMessage } from '../../utils/api-error';
import {
  connectTopologyLive,
  disconnectTopologyLive,
  loadTopology,
  loadTopologyFailure,
  loadTopologySuccess,
  topologyFlowsReceived,
  topologyLiveConnected,
  topologyLiveError,
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
 * `socket/topology`: `subscribe` after connecting (again after a reconnect), then `flows` every 10 s; `error` when
 * the caller has no cluster role or too many subscriptions. `unsubscribe` and close when the live map is left.
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
                    socket.emit('subscribe');
                    subscriber.next(topologyLiveConnected({ connected: true }));
                  });
                  socket.on('disconnect', () => subscriber.next(topologyLiveConnected({ connected: false })));
                  socket.on('flows', (event: TopologyFlowsEvent) => {
                    if (event?.at && Array.isArray(event.edges))
                      subscriber.next(topologyFlowsReceived({ at: event.at, edges: event.edges }));
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
