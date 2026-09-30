import { createReducer, on } from '@ngrx/store';

import {
  connectSocket,
  connectSocketFailure,
  connectSocketSuccess,
  disconnectSocket,
  disconnectSocketSuccess,
  forwardEvent,
  forwardEventFailure,
  forwardEventSuccess,
  remoteDisconnected,
  remoteReconnected,
  remoteReconnectError,
  remoteReconnectFailed,
  remoteReconnecting,
  setAgent,
  setChatModel,
  setChatResponseMode,
  setClient,
  setClientFailure,
  setClientSuccess,
  socketError,
  socketReconnected,
  socketReconnectError,
  socketReconnectFailed,
  socketReconnecting,
  forwardedEventReceived,
} from './container-socket.actions';
import type { AgentResponseMode, LoginSuccessData, LogoutSuccessData } from './container-socket.types';

export interface RemoteConnectionState {
  clientId: string;
  connected: boolean;
  reconnecting: boolean;
  reconnectAttempts: number;
  lastError: string | null;
}

/**
 * Connection/context container for the clients gateway socket.
 * Domain payloads bus into chat-timeline, terminals, files, stats, tickets — not stored here.
 */
export interface ContainerSocketState {
  connected: boolean;
  connecting: boolean;
  disconnecting: boolean;
  reconnecting: boolean;
  reconnectAttempts: number;
  selectedClientId: string | null;
  chatModel: string | null;
  chatResponseMode: AgentResponseMode;
  forwarding: boolean;
  forwardingEvent: string | null;
  error: string | null;
  selectedAgentId: string | null;
  settingClient: boolean;
  settingClientId: string | null;
  remoteConnections: Record<string, RemoteConnectionState>;
}

export const initialContainerSocketState: ContainerSocketState = {
  connected: false,
  connecting: false,
  disconnecting: false,
  reconnecting: false,
  reconnectAttempts: 0,
  selectedClientId: null,
  chatModel: null,
  chatResponseMode: 'stream',
  forwarding: false,
  forwardingEvent: null,
  error: null,
  selectedAgentId: null,
  settingClient: false,
  settingClientId: null,
  remoteConnections: {},
};

export const containerSocketReducer = createReducer(
  initialContainerSocketState,
  on(connectSocket, (state) => ({
    ...state,
    connecting: true,
    error: null,
  })),
  on(connectSocketSuccess, (state) => ({
    ...state,
    connected: true,
    connecting: false,
    reconnecting: false,
    reconnectAttempts: 0,
    error: null,
  })),
  on(connectSocketFailure, (state, { error }) => ({
    ...state,
    connected: false,
    connecting: false,
    reconnecting: false,
    reconnectAttempts: 0,
    error,
  })),
  on(socketReconnecting, (state, { attempt }) => ({
    ...state,
    reconnecting: true,
    reconnectAttempts: attempt,
    error: null,
  })),
  on(socketReconnected, (state) => ({
    ...state,
    connected: true,
    reconnecting: false,
    reconnectAttempts: 0,
    error: null,
  })),
  on(socketReconnectError, (state) => ({
    ...state,
    reconnecting: true,
  })),
  on(socketReconnectFailed, (state, { error }) => ({
    ...state,
    connected: false,
    reconnecting: false,
    reconnectAttempts: 0,
    error,
  })),
  on(disconnectSocket, (state) => ({
    ...state,
    disconnecting: true,
    error: null,
  })),
  on(disconnectSocketSuccess, () => ({ ...initialContainerSocketState })),
  on(setClient, (state, { clientId }) => ({
    ...state,
    settingClient: true,
    settingClientId: clientId,
    error: null,
  })),
  on(setClientSuccess, (state, { clientId }) => {
    const remoteConnections = { ...state.remoteConnections };

    if (!remoteConnections[clientId]) {
      remoteConnections[clientId] = {
        clientId,
        connected: true,
        reconnecting: false,
        reconnectAttempts: 0,
        lastError: null,
      };
    } else {
      remoteConnections[clientId] = {
        ...remoteConnections[clientId],
        connected: true,
        reconnecting: false,
        reconnectAttempts: 0,
        lastError: null,
      };
    }

    return {
      ...state,
      selectedClientId: clientId,
      settingClient: false,
      settingClientId: null,
      error: null,
      remoteConnections,
    };
  }),
  on(setClientFailure, (state, { error }) => ({
    ...state,
    settingClient: false,
    settingClientId: null,
    error,
  })),
  on(setChatModel, (state, { model }) => ({
    ...state,
    chatModel: model,
  })),
  on(setChatResponseMode, (state, { mode }) => ({
    ...state,
    chatResponseMode: mode,
  })),
  on(forwardEvent, (state, { event }) => ({
    ...state,
    forwarding: true,
    forwardingEvent: event,
    error: null,
  })),
  on(forwardEventSuccess, (state, { event }) => {
    if (state.forwardingEvent === event) {
      return {
        ...state,
        forwarding: false,
        forwardingEvent: null,
        error: null,
      };
    }

    return state;
  }),
  on(forwardEventFailure, (state, { error }) => ({
    ...state,
    forwarding: false,
    forwardingEvent: null,
    error,
  })),
  on(socketError, (state, { message }) => ({
    ...state,
    error: message,
  })),
  on(setAgent, (state, { agentId }) => ({
    ...state,
    selectedAgentId: agentId,
  })),
  on(forwardedEventReceived, (state, { event, payload }) => {
    let selectedAgentId = state.selectedAgentId;

    if (event === 'loginSuccess' && payload && typeof payload === 'object' && 'success' in payload && payload.success) {
      const loginData = payload.data as LoginSuccessData;

      selectedAgentId = loginData.agentId;
    } else if (
      event === 'logoutSuccess' &&
      payload &&
      typeof payload === 'object' &&
      'success' in payload &&
      payload.success
    ) {
      const logoutData = payload.data as LogoutSuccessData;

      if (logoutData.agentId === null || logoutData.agentId === state.selectedAgentId) {
        selectedAgentId = null;
      }
    }

    if (selectedAgentId === state.selectedAgentId) {
      return state;
    }

    return {
      ...state,
      selectedAgentId,
    };
  }),
  on(remoteDisconnected, (state, { clientId }) => {
    const remoteConnections = { ...state.remoteConnections };

    if (!remoteConnections[clientId]) {
      remoteConnections[clientId] = {
        clientId,
        connected: false,
        reconnecting: false,
        reconnectAttempts: 0,
        lastError: null,
      };
    } else {
      remoteConnections[clientId] = {
        ...remoteConnections[clientId],
        connected: false,
        reconnecting: false,
        reconnectAttempts: 0,
      };
    }

    return { ...state, remoteConnections };
  }),
  on(remoteReconnecting, (state, { clientId, attempt }) => {
    const remoteConnections = { ...state.remoteConnections };

    if (!remoteConnections[clientId]) {
      remoteConnections[clientId] = {
        clientId,
        connected: false,
        reconnecting: true,
        reconnectAttempts: attempt,
        lastError: null,
      };
    } else {
      remoteConnections[clientId] = {
        ...remoteConnections[clientId],
        reconnecting: true,
        reconnectAttempts: attempt,
      };
    }

    return { ...state, remoteConnections };
  }),
  on(remoteReconnected, (state, { clientId }) => {
    const remoteConnections = { ...state.remoteConnections };

    if (remoteConnections[clientId]) {
      remoteConnections[clientId] = {
        ...remoteConnections[clientId],
        connected: true,
        reconnecting: false,
        reconnectAttempts: 0,
        lastError: null,
      };
    }

    return { ...state, remoteConnections };
  }),
  on(remoteReconnectError, (state, { clientId, error }) => {
    const remoteConnections = { ...state.remoteConnections };

    if (remoteConnections[clientId]) {
      remoteConnections[clientId] = {
        ...remoteConnections[clientId],
        reconnecting: true,
        lastError: error,
      };
    }

    return { ...state, remoteConnections };
  }),
  on(remoteReconnectFailed, (state, { clientId, error }) => {
    const remoteConnections = { ...state.remoteConnections };

    if (remoteConnections[clientId]) {
      remoteConnections[clientId] = {
        ...remoteConnections[clientId],
        connected: false,
        reconnecting: false,
        lastError: error,
      };
    }

    return { ...state, remoteConnections };
  }),
);
