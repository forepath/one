import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { ContainerSocketState } from './container-socket.reducer';

export const selectContainerSocketState = createFeatureSelector<ContainerSocketState>('containerSocket');

export const selectSocketConnected = createSelector(selectContainerSocketState, (state) => state.connected);

export const selectSocketConnecting = createSelector(selectContainerSocketState, (state) => state.connecting);

export const selectSocketDisconnecting = createSelector(selectContainerSocketState, (state) => state.disconnecting);

export const selectSelectedClientId = createSelector(selectContainerSocketState, (state) => state.selectedClientId);

export const selectSettingClient = createSelector(selectContainerSocketState, (state) => state.settingClient);

export const selectSettingClientId = createSelector(selectContainerSocketState, (state) => state.settingClientId);

export const selectChatModel = createSelector(selectContainerSocketState, (state) => state.chatModel);

export const selectChatResponseMode = createSelector(selectContainerSocketState, (state) => state.chatResponseMode);

export const selectSocketForwarding = createSelector(selectContainerSocketState, (state) => state.forwarding);

export const selectChatForwarding = createSelector(
  selectContainerSocketState,
  (state) => state.forwarding && state.forwardingEvent === 'chat',
);

export const selectSocketError = createSelector(selectContainerSocketState, (state) => state.error);

export const selectSocketReconnecting = createSelector(selectContainerSocketState, (state) => state.reconnecting);

export const selectSocketReconnectAttempts = createSelector(
  selectContainerSocketState,
  (state) => state.reconnectAttempts,
);

export const selectRemoteConnections = createSelector(selectContainerSocketState, (state) => state.remoteConnections);

export const selectRemoteConnectionState = (clientId: string) =>
  createSelector(selectRemoteConnections, (connections) => connections[clientId] || null);

export const selectIsRemoteReconnecting = (clientId: string) =>
  createSelector(selectRemoteConnectionState(clientId), (connection) => connection?.reconnecting ?? false);

export const selectRemoteConnectionError = (clientId: string) =>
  createSelector(selectRemoteConnectionState(clientId), (connection) => connection?.lastError ?? null);

export const selectSelectedAgentId = createSelector(selectContainerSocketState, (state) => state.selectedAgentId);
