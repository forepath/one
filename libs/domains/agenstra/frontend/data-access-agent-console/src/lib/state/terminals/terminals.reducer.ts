import { createReducer, on } from '@ngrx/store';

import {
  terminalClosedReceived,
  terminalCreatedReceived,
  terminalOutputReceived,
  terminalsClear,
} from './terminals.actions';

export interface TerminalSession {
  sessionId: string;
  status: 'open' | 'closed';
}

export interface TerminalOutputChunk {
  seq: number;
  sessionId: string;
  data: string;
}

export interface TerminalsState {
  sessions: Record<string, TerminalSession>;
  outputChunks: TerminalOutputChunk[];
  nextSeq: number;
  maxOutputChunks: number;
}

export const initialTerminalsState: TerminalsState = {
  sessions: {},
  outputChunks: [],
  nextSeq: 0,
  maxOutputChunks: 200,
};

export const terminalsReducer = createReducer(
  initialTerminalsState,
  on(terminalCreatedReceived, (state, { sessionId }) => ({
    ...state,
    sessions: {
      ...state.sessions,
      [sessionId]: { sessionId, status: 'open' },
    },
  })),
  on(terminalOutputReceived, (state, { sessionId, data }) => {
    const chunk: TerminalOutputChunk = {
      seq: state.nextSeq,
      sessionId,
      data,
    };
    const updatedChunks = [...state.outputChunks, chunk];
    const trimmedChunks =
      updatedChunks.length > state.maxOutputChunks ? updatedChunks.slice(-state.maxOutputChunks) : updatedChunks;

    return {
      ...state,
      outputChunks: trimmedChunks,
      nextSeq: state.nextSeq + 1,
    };
  }),
  on(terminalClosedReceived, (state, { sessionId }) => ({
    ...state,
    sessions: {
      ...state.sessions,
      [sessionId]: { sessionId, status: 'closed' },
    },
  })),
  on(terminalsClear, () => initialTerminalsState),
);
