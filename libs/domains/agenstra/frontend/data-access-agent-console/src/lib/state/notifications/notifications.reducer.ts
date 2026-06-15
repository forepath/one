import { createReducer, on } from '@ngrx/store';

import {
  connectNotificationsSocket,
  connectNotificationsSocketFailure,
  connectNotificationsSocketSuccess,
  disconnectNotificationsSocket,
  disconnectNotificationsSocketSuccess,
  notificationsSocketError,
  notificationsSocketReconnected,
  notificationsSocketReconnectError,
  notificationsSocketReconnectFailed,
  notificationsSocketReconnecting,
  setActiveEnvironmentLocal,
  statusPatchReceived,
  statusSnapshotReceived,
} from './notifications.actions';
import type { ClientStatus, EnvironmentStatus } from './notifications.types';

export interface NotificationsState {
  socketConnected: boolean;
  socketConnecting: boolean;
  socketError: string | null;
  environmentsByKey: Record<string, EnvironmentStatus>;
  clientsById: Record<string, ClientStatus>;
  spacesHasAttention: boolean;
  activeEnvironment: { clientId: string; agentId: string } | null;
}

export const initialNotificationsState: NotificationsState = {
  socketConnected: false,
  socketConnecting: false,
  socketError: null,
  environmentsByKey: {},
  clientsById: {},
  spacesHasAttention: false,
  activeEnvironment: null,
};

function envKey(clientId: string, agentId: string): string {
  return `${clientId}:${agentId}`;
}

function recomputeSpacesAttention(clientsById: Record<string, ClientStatus>): boolean {
  return Object.values(clientsById).some((c) => c.hasUnreadMessages || c.gitDirty);
}

function rebuildClientsFromEnvironments(
  environmentsByKey: Record<string, EnvironmentStatus>,
): Record<string, ClientStatus> {
  const clients: Record<string, ClientStatus> = {};

  for (const env of Object.values(environmentsByKey)) {
    const existing = clients[env.clientId] ?? {
      clientId: env.clientId,
      hasUnreadMessages: false,
      gitDirty: false,
    };

    clients[env.clientId] = {
      clientId: env.clientId,
      hasUnreadMessages: existing.hasUnreadMessages || env.hasUnreadMessages,
      gitDirty: existing.gitDirty || env.gitDirty,
    };
  }

  return clients;
}

export const notificationsReducer = createReducer(
  initialNotificationsState,
  on(connectNotificationsSocket, (state) => ({
    ...state,
    socketConnecting: true,
    socketError: null,
  })),
  on(connectNotificationsSocketSuccess, (state) => ({
    ...state,
    socketConnected: true,
    socketConnecting: false,
    socketError: null,
  })),
  on(connectNotificationsSocketFailure, (state, { error }) => ({
    ...initialNotificationsState,
    socketError: error,
  })),
  on(disconnectNotificationsSocket, (state) => ({ ...state, socketConnecting: false })),
  on(disconnectNotificationsSocketSuccess, () => ({ ...initialNotificationsState })),
  on(notificationsSocketReconnecting, (state) => ({ ...state, socketConnecting: true })),
  on(notificationsSocketReconnected, (state) => ({
    ...state,
    socketConnected: true,
    socketConnecting: false,
  })),
  on(notificationsSocketReconnectError, (state, { error }) => ({ ...state, socketError: error })),
  on(notificationsSocketReconnectFailed, (state, { error }) => ({
    ...state,
    socketConnected: false,
    socketConnecting: false,
    socketError: error,
  })),
  on(notificationsSocketError, (state, { message }) => ({ ...state, socketError: message })),
  on(statusSnapshotReceived, (state, { snapshot }) => {
    const environmentsByKey: Record<string, EnvironmentStatus> = {};

    for (const env of snapshot.environments) {
      environmentsByKey[envKey(env.clientId, env.agentId)] = env;
    }

    const clientsById: Record<string, ClientStatus> = {};

    for (const client of snapshot.clients) {
      clientsById[client.clientId] = client;
    }

    return {
      ...state,
      environmentsByKey,
      clientsById,
      spacesHasAttention: snapshot.spacesHasAttention,
    };
  }),
  on(statusPatchReceived, (state, { patch }) => {
    const environmentsByKey = { ...state.environmentsByKey };

    if (patch.environments?.length) {
      for (const env of patch.environments) {
        environmentsByKey[envKey(env.clientId, env.agentId)] = env;
      }
    }

    let clientsById = { ...state.clientsById };

    if (patch.environments?.length && Object.keys(environmentsByKey).length > 0) {
      clientsById = rebuildClientsFromEnvironments(environmentsByKey);
    } else if (patch.clients?.length) {
      for (const client of patch.clients) {
        clientsById[client.clientId] = client;
      }
    }

    const spacesHasAttention = recomputeSpacesAttention(clientsById);

    return {
      ...state,
      environmentsByKey,
      clientsById,
      spacesHasAttention,
    };
  }),
  on(setActiveEnvironmentLocal, (state, { active }) => ({
    ...state,
    activeEnvironment: active,
  })),
);
