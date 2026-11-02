import { createReducer, on } from '@ngrx/store';

import type { LogFilter, LogLine } from '../../types/logs.types';
import {
  clearLogsTail,
  loadLogsPage,
  loadLogsPageFailure,
  loadLogsPageSuccess,
  logsTailConnected,
  logsTailError,
  logsTailReceived,
  searchLogs,
  startLogsTail,
  stopLogsTail,
} from './logs.actions';

/** Lines a tail keeps (newest first). */
export const LOGS_TAIL_MAX = 2_000;

export interface ConsoleLogsState {
  /** The current search (with a fixed time range, so paging is stable). */
  filter: LogFilter | null;
  limit: number;
  lines: LogLine[];
  page: number;
  /** `cursors[i]`: the cursor page `i` was read from (`null` for the first page). */
  cursors: (string | null)[];
  /** The cursor of the next (older) page; `null` on the last. */
  nextCursor: string | null;
  loading: boolean;
  error: string | null;
  tailing: boolean;
  tailConnected: boolean;
  tailError: string | null;
  tail: LogLine[];
}

export const initialConsoleLogsState: ConsoleLogsState = {
  filter: null,
  limit: 100,
  lines: [],
  page: 0,
  cursors: [null],
  nextCursor: null,
  loading: false,
  error: null,
  tailing: false,
  tailConnected: false,
  tailError: null,
  tail: [],
};

export const consoleLogsReducer = createReducer(
  initialConsoleLogsState,
  on(searchLogs, (state, { filter, limit }) => ({
    ...state,
    filter,
    limit,
    lines: [],
    page: 0,
    cursors: [null],
    nextCursor: null,
    error: null,
  })),
  on(loadLogsPage, (state, { page, cursor }) => {
    const cursors = state.cursors.slice(0, page);

    cursors[page] = cursor;

    return { ...state, page, cursors, loading: true, error: null };
  }),
  on(loadLogsPageSuccess, (state, { page, result }) =>
    page === state.page ? { ...state, lines: result.lines, nextCursor: result.cursor, loading: false } : state,
  ),
  on(loadLogsPageFailure, (state, { page, error }) =>
    page === state.page ? { ...state, loading: false, error } : state,
  ),
  on(startLogsTail, (state) => ({ ...state, tailing: true, tailConnected: false, tailError: null, tail: [] })),
  on(stopLogsTail, (state) => ({ ...state, tailing: false, tailConnected: false })),
  on(logsTailConnected, (state, { connected }) => ({ ...state, tailConnected: state.tailing && connected })),
  on(logsTailReceived, (state, { lines }) =>
    state.tailing ? { ...state, tail: [...[...lines].reverse(), ...state.tail].slice(0, LOGS_TAIL_MAX) } : state,
  ),
  on(logsTailError, (state, { error }) => ({ ...state, tailError: error })),
  on(clearLogsTail, (state) => ({ ...state, tail: [] })),
);
