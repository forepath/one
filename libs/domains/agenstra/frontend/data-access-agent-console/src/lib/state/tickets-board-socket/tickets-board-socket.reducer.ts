import { createReducer, on } from '@ngrx/store';

import {
  connectTicketsBoardSocket,
  connectTicketsBoardSocketFailure,
  connectTicketsBoardSocketSuccess,
  disconnectTicketsBoardSocket,
  disconnectTicketsBoardSocketSuccess,
  setTicketsBoardSocketClient,
  setTicketsBoardSocketClientSuccess,
  ticketsBoardSocketError,
  ticketsBoardSocketReconnected,
  ticketsBoardSocketReconnectError,
  ticketsBoardSocketReconnectFailed,
  ticketsBoardSocketReconnecting,
} from './tickets-board-socket.actions';

export interface TicketsBoardSocketState {
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

export const initialTicketsBoardSocketState: TicketsBoardSocketState = {
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

export const ticketsBoardSocketReducer = createReducer(
  initialTicketsBoardSocketState,
  on(connectTicketsBoardSocket, (state) => ({
    ...state,
    connecting: true,
    disconnecting: false,
    error: null,
  })),
  on(connectTicketsBoardSocketSuccess, (state) => ({
    ...state,
    connected: true,
    connecting: false,
    reconnecting: false,
    reconnectAttempts: 0,
    error: null,
  })),
  on(connectTicketsBoardSocketFailure, (state, { error }) => ({
    ...initialTicketsBoardSocketState,
    error,
  })),
  on(disconnectTicketsBoardSocket, (state) => ({
    ...state,
    disconnecting: true,
    error: null,
  })),
  on(disconnectTicketsBoardSocketSuccess, () => ({ ...initialTicketsBoardSocketState })),
  on(ticketsBoardSocketReconnecting, (state, { attempt }) => ({
    ...state,
    reconnecting: true,
    reconnectAttempts: attempt,
  })),
  on(ticketsBoardSocketReconnected, (state) => ({
    ...state,
    connected: true,
    reconnecting: false,
    reconnectAttempts: 0,
  })),
  on(ticketsBoardSocketReconnectError, (state, { error }) => ({
    ...state,
    error,
  })),
  on(ticketsBoardSocketReconnectFailed, (state, { error }) => ({
    ...state,
    connected: false,
    reconnecting: false,
    error,
  })),
  on(setTicketsBoardSocketClient, (state, { clientId }) => ({
    ...state,
    settingClient: true,
    settingClientId: clientId,
    error: null,
  })),
  on(setTicketsBoardSocketClientSuccess, (state, { clientId }) => ({
    ...state,
    selectedClientId: clientId,
    settingClient: false,
    settingClientId: null,
    error: null,
  })),
  on(ticketsBoardSocketError, (state, { message }) => ({
    ...state,
    settingClient: false,
    settingClientId: null,
    error: message,
  })),
);
