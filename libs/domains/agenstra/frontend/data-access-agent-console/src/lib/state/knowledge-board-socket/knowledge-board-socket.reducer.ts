import { createReducer, on } from '@ngrx/store';

import {
  connectKnowledgeBoardSocket,
  connectKnowledgeBoardSocketFailure,
  connectKnowledgeBoardSocketSuccess,
  disconnectKnowledgeBoardSocket,
  disconnectKnowledgeBoardSocketSuccess,
  knowledgeBoardSocketError,
  knowledgeBoardSocketReconnected,
  knowledgeBoardSocketReconnectError,
  knowledgeBoardSocketReconnectFailed,
  knowledgeBoardSocketReconnecting,
  setKnowledgeBoardSocketClient,
  setKnowledgeBoardSocketClientSuccess,
} from './knowledge-board-socket.actions';

export interface KnowledgeBoardSocketState {
  connected: boolean;
  connecting: boolean;
  disconnecting: boolean;
  reconnecting: boolean;
  reconnectAttempts: number;
  selectedClientId: string | null;
  settingClient: boolean;
  settingClientId: string | null;
  error: string | null;
}

export const initialKnowledgeBoardSocketState: KnowledgeBoardSocketState = {
  connected: false,
  connecting: false,
  disconnecting: false,
  reconnecting: false,
  reconnectAttempts: 0,
  selectedClientId: null,
  settingClient: false,
  settingClientId: null,
  error: null,
};

export const knowledgeBoardSocketReducer = createReducer(
  initialKnowledgeBoardSocketState,
  on(connectKnowledgeBoardSocket, (state) => ({ ...state, connecting: true, disconnecting: false, error: null })),
  on(connectKnowledgeBoardSocketSuccess, (state) => ({
    ...state,
    connected: true,
    connecting: false,
    reconnecting: false,
    reconnectAttempts: 0,
    error: null,
  })),
  on(connectKnowledgeBoardSocketFailure, (state, { error }) => ({ ...initialKnowledgeBoardSocketState, error })),
  on(disconnectKnowledgeBoardSocket, (state) => ({ ...state, disconnecting: true, error: null })),
  on(disconnectKnowledgeBoardSocketSuccess, () => ({ ...initialKnowledgeBoardSocketState })),
  on(knowledgeBoardSocketReconnecting, (state, { attempt }) => ({
    ...state,
    reconnecting: true,
    reconnectAttempts: attempt,
  })),
  on(knowledgeBoardSocketReconnected, (state) => ({
    ...state,
    connected: true,
    reconnecting: false,
    reconnectAttempts: 0,
  })),
  on(knowledgeBoardSocketReconnectError, (state, { error }) => ({ ...state, error })),
  on(knowledgeBoardSocketReconnectFailed, (state, { error }) => ({
    ...state,
    connected: false,
    reconnecting: false,
    error,
  })),
  on(setKnowledgeBoardSocketClient, (state, { clientId }) => ({
    ...state,
    settingClient: true,
    settingClientId: clientId,
    error: null,
  })),
  on(setKnowledgeBoardSocketClientSuccess, (state, { clientId }) => ({
    ...state,
    selectedClientId: clientId,
    settingClient: false,
    settingClientId: null,
    error: null,
  })),
  on(knowledgeBoardSocketError, (state, { message }) => ({
    ...state,
    settingClient: false,
    settingClientId: null,
    error: message,
  })),
);
