import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store, type Action } from '@ngrx/store';
import { catchError, filter, from, map, Observable, of, switchMap, takeUntil, withLatestFrom } from 'rxjs';

import { LogsService } from '../../services/logs.service';
import { ConsoleSocketService } from '../../sockets/console-socket';
import type { LogFilter, LogLinesEvent } from '../../types/logs.types';
import { apiErrorMessage } from '../../utils/api-error';
import {
  loadLogsPage,
  loadLogsPageFailure,
  loadLogsPageSuccess,
  logsTailConnected,
  logsTailError,
  logsTailReceived,
  nextLogsPage,
  previousLogsPage,
  searchLogs,
  startLogsTail,
  stopLogsTail,
} from './logs.actions';
import { selectConsoleLogsState } from './logs.selectors';

/** The tail's `subscribe` body: the filter without what doesn't apply (the gateway rejects unknown fields). */
export function tailFilter(filter: LogFilter): LogFilter {
  const body: LogFilter = {};

  for (const key of [
    'sources',
    'levels',
    'project',
    'deployment',
    'service',
    'replica',
    'node',
    'policy',
    'text',
  ] as const) {
    const value = filter[key];

    if (value !== undefined && value !== '' && !(Array.isArray(value) && value.length === 0))
      (body as Record<string, unknown>)[key] = value;
  }

  return body;
}

export const searchLogs$ = createEffect(
  (actions$ = inject(Actions)) =>
    actions$.pipe(
      ofType(searchLogs),
      map(() => loadLogsPage({ page: 0, cursor: null })),
    ),
  { functional: true },
);

export const logsPageNavigation$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store)) =>
    actions$.pipe(
      ofType(nextLogsPage, previousLogsPage),
      withLatestFrom(store.select(selectConsoleLogsState)),
      filter(([action, state]) =>
        action.type === nextLogsPage.type ? state.nextCursor !== null && !state.loading : state.page > 0,
      ),
      map(([action, state]) =>
        action.type === nextLogsPage.type
          ? loadLogsPage({ page: state.page + 1, cursor: state.nextCursor })
          : loadLogsPage({ page: state.page - 1, cursor: state.cursors[state.page - 1] ?? null }),
      ),
    ),
  { functional: true },
);

export const loadLogsPage$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store), service = inject(LogsService)) =>
    actions$.pipe(
      ofType(loadLogsPage),
      withLatestFrom(store.select(selectConsoleLogsState)),
      filter(([, state]) => state.filter !== null),
      switchMap(([{ page, cursor }, state]) =>
        service
          .query({ ...(state.filter as LogFilter), limit: state.limit, order: 'desc', ...(cursor ? { cursor } : {}) })
          .pipe(
            map((result) => loadLogsPageSuccess({ page, result })),
            catchError((error: unknown) =>
              of(loadLogsPageFailure({ page, error: apiErrorMessage(error, 'Failed to load logs') })),
            ),
          ),
      ),
    ),
  { functional: true },
);

/**
 * `socket/logs`: `subscribe` with the filter after connecting (again after a reconnect), then `logLines` with every
 * new matching line; `error` for an invalid filter or a project the caller can't read (the tail then ends).
 */
export const logsTail$ = createEffect(
  (actions$ = inject(Actions), sockets = inject(ConsoleSocketService)) =>
    actions$.pipe(
      ofType(startLogsTail),
      switchMap(({ filter: tail }) =>
        from(sockets.open('logs')).pipe(
          switchMap((socket) =>
            socket
              ? new Observable<Action>((subscriber) => {
                  socket.on('connect', () => {
                    socket.emit('subscribe', tailFilter(tail));
                    subscriber.next(logsTailConnected({ connected: true }));
                  });
                  socket.on('disconnect', () => subscriber.next(logsTailConnected({ connected: false })));
                  socket.on('logLines', (event: LogLinesEvent) => {
                    if (Array.isArray(event?.lines) && event.lines.length > 0)
                      subscriber.next(logsTailReceived({ lines: event.lines }));
                  });
                  socket.on('error', (event: { message?: string } | undefined) =>
                    subscriber.next(logsTailError({ error: event?.message ?? 'The live tail ended' })),
                  );
                  socket.on('connect_error', (error: Error) =>
                    subscriber.next(logsTailError({ error: error?.message || 'The live tail failed' })),
                  );

                  return () => {
                    if (socket.connected) socket.emit('unsubscribe');

                    socket.removeAllListeners();
                    socket.disconnect();
                  };
                })
              : of(logsTailConnected({ connected: false })),
          ),
          catchError(() => of(logsTailConnected({ connected: false }))),
          takeUntil(actions$.pipe(ofType(stopLogsTail))),
        ),
      ),
    ),
  { functional: true },
);
