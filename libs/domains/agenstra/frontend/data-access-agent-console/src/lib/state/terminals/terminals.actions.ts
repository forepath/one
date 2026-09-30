import { createAction, props } from '@ngrx/store';

import type {
  SuccessResponse,
  TerminalClosedData,
  TerminalCreatedData,
  TerminalOutputData,
} from '../container-socket/container-socket.types';

/**
 * Dispatched when a terminalCreated forwarded event is received.
 */
export const terminalCreatedReceived = createAction(
  '[Terminals] Terminal Created Received',
  props<SuccessResponse<TerminalCreatedData>['data']>(),
);

/**
 * Dispatched when a terminalOutput forwarded event is received.
 */
export const terminalOutputReceived = createAction(
  '[Terminals] Terminal Output Received',
  props<SuccessResponse<TerminalOutputData>['data']>(),
);

/**
 * Dispatched when a terminalClosed forwarded event is received.
 */
export const terminalClosedReceived = createAction(
  '[Terminals] Terminal Closed Received',
  props<SuccessResponse<TerminalClosedData>['data']>(),
);

/**
 * Clears all terminal sessions and output chunks.
 */
export const terminalsClear = createAction('[Terminals] Clear');
