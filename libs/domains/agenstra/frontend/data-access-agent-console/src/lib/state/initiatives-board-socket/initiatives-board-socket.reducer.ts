import { createReducer, on } from '@ngrx/store';

import {
  connectInitiativesBoardSocket,
  connectInitiativesBoardSocketFailure,
  connectInitiativesBoardSocketSuccess,
  disconnectInitiativesBoardSocket,
  disconnectInitiativesBoardSocketSuccess,
  initiativesBoardSocketError,
  initiativesBoardSocketReconnected,
  initiativesBoardSocketReconnectError,
  initiativesBoardSocketReconnectFailed,
  initiativesBoardSocketReconnecting,
  setInitiativesBoardSocketClient,
  setInitiativesBoardSocketClientSuccess,
} from './initiatives-board-socket.actions';

export interface InitiativesBoardSocketState {
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

export const initialInitiativesBoardSocketState: InitiativesBoardSocketState = {
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

export const initiativesBoardSocketReducer = createReducer(
  initialInitiativesBoardSocketState,
  on(connectInitiativesBoardSocket, (state) => ({ ...state, connecting: true, disconnecting: false, error: null })),
  on(connectInitiativesBoardSocketSuccess, (state) => ({
    ...state,
    connected: true,
    connecting: false,
    reconnecting: false,
    reconnectAttempts: 0,
    error: null,
  })),
  on(connectInitiativesBoardSocketFailure, (state, { error }) => ({ ...initialInitiativesBoardSocketState, error })),
  on(disconnectInitiativesBoardSocket, (state) => ({ ...state, disconnecting: true, error: null })),
  on(disconnectInitiativesBoardSocketSuccess, () => ({ ...initialInitiativesBoardSocketState })),
  on(initiativesBoardSocketReconnecting, (state, { attempt }) => ({
    ...state,
    reconnecting: true,
    reconnectAttempts: attempt,
  })),
  on(initiativesBoardSocketReconnected, (state) => ({
    ...state,
    connected: true,
    reconnecting: false,
    reconnectAttempts: 0,
  })),
  on(initiativesBoardSocketReconnectError, (state, { error }) => ({ ...state, error })),
  on(initiativesBoardSocketReconnectFailed, (state, { error }) => ({
    ...state,
    connected: false,
    reconnecting: false,
    error,
  })),
  on(setInitiativesBoardSocketClient, (state, { clientId }) => ({
    ...state,
    settingClient: true,
    settingClientId: clientId,
    error: null,
  })),
  on(setInitiativesBoardSocketClientSuccess, (state, { clientId }) => ({
    ...state,
    selectedClientId: clientId,
    settingClient: false,
    settingClientId: null,
    error: null,
  })),
  on(initiativesBoardSocketError, (state, { message }) => ({
    ...state,
    settingClient: false,
    settingClientId: null,
    error: message,
  })),
);
