import { createFeatureSelector, createSelector } from '@ngrx/store';

import { resolveAttentionBadgeKind, resolveSpacesAttentionBadgeKind } from './notifications-attention.util';
import type { NotificationsState } from './notifications.reducer';

export const selectNotificationsState = createFeatureSelector<NotificationsState>('notifications');

export const selectSpacesHasAttention = createSelector(selectNotificationsState, (state) => state.spacesHasAttention);

export const selectSpacesAttentionBadge = createSelector(selectNotificationsState, (state) =>
  resolveSpacesAttentionBadgeKind(Object.values(state.clientsById)),
);

export const selectActiveEnvironment = createSelector(selectNotificationsState, (state) => state.activeEnvironment);

export const selectEnvironmentStatus = (clientId: string, agentId: string) =>
  createSelector(selectNotificationsState, (state) => state.environmentsByKey[`${clientId}:${agentId}`] ?? null);

export const selectClientStatus = (clientId: string) =>
  createSelector(selectNotificationsState, (state) => state.clientsById[clientId] ?? null);

export const selectClientHasUnread = (clientId: string) =>
  createSelector(selectClientStatus(clientId), (client) => client?.hasUnreadMessages ?? false);

export const selectClientGitDirty = (clientId: string) =>
  createSelector(selectClientStatus(clientId), (client) => client?.gitDirty ?? false);

export const selectEnvironmentHasUnread = (clientId: string, agentId: string) =>
  createSelector(selectEnvironmentStatus(clientId, agentId), (env) => env?.hasUnreadMessages ?? false);

export const selectEnvironmentGitDirty = (clientId: string, agentId: string) =>
  createSelector(selectEnvironmentStatus(clientId, agentId), (env) => env?.gitDirty ?? false);

export const selectClientAttentionBadge = (clientId: string) =>
  createSelector(selectClientGitDirty(clientId), selectClientHasUnread(clientId), (gitDirty, hasUnread) =>
    resolveAttentionBadgeKind(gitDirty, hasUnread),
  );

export const selectEnvironmentAttentionBadge = (clientId: string, agentId: string) =>
  createSelector(
    selectEnvironmentGitDirty(clientId, agentId),
    selectEnvironmentHasUnread(clientId, agentId),
    (gitDirty, hasUnread) => resolveAttentionBadgeKind(gitDirty, hasUnread),
  );
