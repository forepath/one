import { createAction, props } from '@ngrx/store';

import type { LogFilter, LogLine, LogPage } from '../../types/logs.types';

/** A new search: the first page of the filter. */
export const searchLogs = createAction('[ConsoleLogs] Search', props<{ filter: LogFilter; limit: number }>());
/** Page `page` of the current search, read from `cursor` (`null` for the first). */
export const loadLogsPage = createAction('[ConsoleLogs] Load Page', props<{ page: number; cursor: string | null }>());
export const loadLogsPageSuccess = createAction(
  '[ConsoleLogs] Load Page Success',
  props<{ page: number; result: LogPage }>(),
);
export const loadLogsPageFailure = createAction(
  '[ConsoleLogs] Load Page Failure',
  props<{ page: number; error: string }>(),
);
export const nextLogsPage = createAction('[ConsoleLogs] Next Page');
export const previousLogsPage = createAction('[ConsoleLogs] Previous Page');

/** Live tail over `socket/logs` with a filter (time range, paging and order don't apply). */
export const startLogsTail = createAction('[ConsoleLogs] Start Tail', props<{ filter: LogFilter }>());
export const stopLogsTail = createAction('[ConsoleLogs] Stop Tail');
export const logsTailConnected = createAction('[ConsoleLogs] Tail Connected', props<{ connected: boolean }>());
export const logsTailReceived = createAction('[ConsoleLogs] Tail Received', props<{ lines: LogLine[] }>());
export const logsTailError = createAction('[ConsoleLogs] Tail Error', props<{ error: string }>());
export const clearLogsTail = createAction('[ConsoleLogs] Clear Tail');
