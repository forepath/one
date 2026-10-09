import { createReducer, on } from '@ngrx/store';

import {
  connectNotificationsSocket,
  connectNotificationsSocketFailure,
  connectNotificationsSocketSuccess,
  disconnectNotificationsSocket,
  disconnectNotificationsSocketSuccess,
  markChatSessionRead,
  markEnvironmentRead,
  notificationsSocketError,
  notificationsSocketReconnected,
  notificationsSocketReconnectError,
  notificationsSocketReconnectFailed,
  notificationsSocketReconnecting,
  setActiveEnvironmentLocal,
  statusPatchReceived,
  statusSnapshotReceived,
} from './notifications.actions';
import type { ActiveEnvironment, ChatSessionStatus, ClientStatus, EnvironmentStatus } from './notifications.types';

/**
 * Ignore stale unread=true briefly after an optimistic mark-read.
 * Keep short so a real reply on another session (e.g. primary) can surface quickly.
 */
const OPTIMISTIC_READ_SUPPRESS_MS = 5_000;

export interface NotificationsState {
  socketConnected: boolean;
  socketConnecting: boolean;
  socketError: string | null;
  environmentsByKey: Record<string, EnvironmentStatus>;
  clientsById: Record<string, ClientStatus>;
  spacesHasAttention: boolean;
  activeEnvironment: ActiveEnvironment | null;
  /**
   * Local mark-read timestamps (`clientId:agentId:chatSessionId` → epoch ms).
   * Blocks stale patches from resurrecting unread until confirmed or expired.
   */
  optimisticChatReadAtByKey: Record<string, number>;
}

export const initialNotificationsState: NotificationsState = {
  socketConnected: false,
  socketConnecting: false,
  socketError: null,
  environmentsByKey: {},
  clientsById: {},
  spacesHasAttention: false,
  activeEnvironment: null,
  optimisticChatReadAtByKey: {},
};

function envKey(clientId: string, agentId: string): string {
  return `${clientId}:${agentId}`;
}

function chatReadKey(clientId: string, agentId: string, chatSessionId: string): string {
  return `${clientId}:${agentId}:${chatSessionId}`;
}

function normalizeEnvironment(env: EnvironmentStatus): EnvironmentStatus {
  return {
    ...env,
    chats: env.chats ?? [],
  };
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

function clearChatUnread(
  state: NotificationsState,
  clientId: string,
  agentId: string,
  chatSessionId: string,
  markedAt = Date.now(),
): NotificationsState {
  const key = envKey(clientId, agentId);
  const env = state.environmentsByKey[key];
  const optimisticChatReadAtByKey = {
    ...state.optimisticChatReadAtByKey,
    [chatReadKey(clientId, agentId, chatSessionId)]: markedAt,
  };

  if (!env) {
    return {
      ...state,
      optimisticChatReadAtByKey,
    };
  }

  const chats = (env.chats ?? []).map((chat) =>
    chat.chatSessionId === chatSessionId ? { ...chat, hasUnreadMessages: false } : chat,
  );
  const hasUnreadMessages = chats.some((chat) => chat.hasUnreadMessages);
  const environmentsByKey = {
    ...state.environmentsByKey,
    [key]: { ...env, chats, hasUnreadMessages },
  };
  const clientsById = rebuildClientsFromEnvironments(environmentsByKey);

  return {
    ...state,
    environmentsByKey,
    clientsById,
    spacesHasAttention: recomputeSpacesAttention(clientsById),
    optimisticChatReadAtByKey,
  };
}

/**
 * Merge server env status with local optimistic read suppressions.
 * Returns updated optimistic map (clears keys confirmed read or expired).
 */
export function mergeEnvironmentWithOptimisticReads(
  env: EnvironmentStatus,
  optimisticChatReadAtByKey: Record<string, number>,
  _payloadGeneratedAt: string | undefined,
  now = Date.now(),
): { environment: EnvironmentStatus; optimisticChatReadAtByKey: Record<string, number> } {
  const nextOptimistic = { ...optimisticChatReadAtByKey };
  const incomingChats = env.chats ?? [];
  const chats: ChatSessionStatus[] = incomingChats.map((chat) => {
    const key = chatReadKey(env.clientId, env.agentId, chat.chatSessionId);
    const optimisticAt = nextOptimistic[key];

    if (optimisticAt != null && now - optimisticAt > OPTIMISTIC_READ_SUPPRESS_MS) {
      delete nextOptimistic[key];
    }

    const suppressActive = nextOptimistic[key] != null;

    if (!chat.hasUnreadMessages) {
      // Keep suppress until TTL so a slower in-flight unread=true patch (e.g. VCS build)
      // cannot clear suppress and then resurrect the badge.
      return { ...chat, hasUnreadMessages: false };
    }

    if (suppressActive) {
      // Block in-flight unread=true from resurrecting the badge right after mark-read.
      return { ...chat, hasUnreadMessages: false };
    }

    return { ...chat, hasUnreadMessages: true };
  });

  const hasUnreadMessages =
    incomingChats.length > 0 ? chats.some((chat) => chat.hasUnreadMessages) : Boolean(env.hasUnreadMessages);

  return {
    environment: {
      ...env,
      chats,
      hasUnreadMessages,
    },
    optimisticChatReadAtByKey: nextOptimistic,
  };
}

function applyEnvironmentsFromPayload(
  state: NotificationsState,
  environments: EnvironmentStatus[],
  payloadGeneratedAt: string | undefined,
  replaceAll: boolean,
): Pick<NotificationsState, 'environmentsByKey' | 'clientsById' | 'spacesHasAttention' | 'optimisticChatReadAtByKey'> {
  let optimisticChatReadAtByKey = { ...state.optimisticChatReadAtByKey };
  const environmentsByKey = replaceAll ? ({} as Record<string, EnvironmentStatus>) : { ...state.environmentsByKey };

  for (const raw of environments) {
    const normalized = normalizeEnvironment(raw);
    const merged = mergeEnvironmentWithOptimisticReads(normalized, optimisticChatReadAtByKey, payloadGeneratedAt);

    optimisticChatReadAtByKey = merged.optimisticChatReadAtByKey;
    environmentsByKey[envKey(merged.environment.clientId, merged.environment.agentId)] = merged.environment;
  }

  const clientsById = rebuildClientsFromEnvironments(environmentsByKey);

  return {
    environmentsByKey,
    clientsById,
    spacesHasAttention: recomputeSpacesAttention(clientsById),
    optimisticChatReadAtByKey,
  };
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
    const applied = applyEnvironmentsFromPayload(state, snapshot.environments, snapshot.generatedAt, true);

    return {
      ...state,
      ...applied,
    };
  }),
  on(statusPatchReceived, (state, { patch }) => {
    if (patch.environments?.length) {
      const applied = applyEnvironmentsFromPayload(state, patch.environments, patch.generatedAt, false);

      return {
        ...state,
        ...applied,
      };
    }

    if (!patch.clients?.length && patch.spacesHasAttention === undefined) {
      // e.g. progress-only patches (handled by the environment-progress slice)
      return state;
    }

    const clientsById = { ...state.clientsById };

    if (patch.clients?.length) {
      for (const client of patch.clients) {
        clientsById[client.clientId] = client;
      }
    }

    return {
      ...state,
      clientsById,
      spacesHasAttention: recomputeSpacesAttention(clientsById),
    };
  }),
  on(markChatSessionRead, (state, { clientId, agentId, chatSessionId }) =>
    clearChatUnread(state, clientId, agentId, chatSessionId),
  ),
  on(markEnvironmentRead, (state, { clientId, agentId, chatSessionId }) => {
    if (!chatSessionId) {
      return state;
    }

    return clearChatUnread(state, clientId, agentId, chatSessionId);
  }),
  on(setActiveEnvironmentLocal, (state, { active }) => ({
    ...state,
    activeEnvironment: active,
  })),
);
