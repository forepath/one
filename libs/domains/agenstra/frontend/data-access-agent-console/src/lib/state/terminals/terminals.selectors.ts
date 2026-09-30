import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { TerminalsState } from './terminals.reducer';

export const selectTerminalsState = createFeatureSelector<TerminalsState>('terminals');

export const selectTerminalSessions = createSelector(selectTerminalsState, (state) => state.sessions);

export const selectTerminalOutputChunks = createSelector(selectTerminalsState, (state) => state.outputChunks);

/**
 * Select output chunks with seq greater than the given value.
 * @param seq - Exclusive lower bound; chunks with seq > seq are returned
 */
export const selectTerminalOutputChunksSince = (seq: number) =>
  createSelector(selectTerminalOutputChunks, (chunks) => chunks.filter((chunk) => chunk.seq > seq));
