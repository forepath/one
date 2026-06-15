import { createFeatureSelector, createSelector } from '@ngrx/store';

import { CLIENT_CHAT_AUTOMATION_SOCKET_EVENT } from './client-chat-automation.constants';
import type { SocketsState } from './sockets.reducer';
import type { ChatMessageData, TicketAutomationRunChatEventPayload } from './sockets.types';

export const selectSocketsState = createFeatureSelector<SocketsState>('sockets');

// Connection state selectors
export const selectSocketConnected = createSelector(selectSocketsState, (state) => state.connected);

export const selectSocketConnecting = createSelector(selectSocketsState, (state) => state.connecting);

export const selectSocketDisconnecting = createSelector(selectSocketsState, (state) => state.disconnecting);

// Client context selectors
export const selectSelectedClientId = createSelector(selectSocketsState, (state) => state.selectedClientId);

export const selectSettingClient = createSelector(selectSocketsState, (state) => state.settingClient);

export const selectSettingClientId = createSelector(selectSocketsState, (state) => state.settingClientId);

export const selectChatModel = createSelector(selectSocketsState, (state) => state.chatModel);

export const selectChatResponseMode = createSelector(selectSocketsState, (state) => state.chatResponseMode);

// Forwarding state selectors
export const selectSocketForwarding = createSelector(selectSocketsState, (state) => state.forwarding);

// Select forwarding state for chat events only
export const selectChatForwarding = createSelector(
  selectSocketsState,
  (state) => state.forwarding && state.forwardingEvent === 'chat',
);

export const selectChatEnhancementPending = createSelector(
  selectSocketsState,
  (state) => state.chatEnhancementPendingCorrelationId !== null,
);

export const selectChatEnhancementLastResult = createSelector(
  selectSocketsState,
  (state) => state.chatEnhancementLastResult,
);

export const selectTicketBodyGenerationPending = createSelector(
  selectSocketsState,
  (state) => state.ticketBodyPendingCorrelationId !== null,
);

export const selectTicketBodyLastResult = createSelector(selectSocketsState, (state) => state.ticketBodyLastResult);

// Error selector
export const selectSocketError = createSelector(selectSocketsState, (state) => state.error);

// Reconnection state selectors (main socket)
export const selectSocketReconnecting = createSelector(selectSocketsState, (state) => state.reconnecting);
export const selectSocketReconnectAttempts = createSelector(selectSocketsState, (state) => state.reconnectAttempts);

// Remote connection state selectors (per clientId)
export const selectRemoteConnections = createSelector(selectSocketsState, (state) => state.remoteConnections);

/**
 * Select remote connection state for a specific clientId
 */
export const selectRemoteConnectionState = (clientId: string) =>
  createSelector(selectRemoteConnections, (connections) => connections[clientId] || null);

/**
 * Select whether a remote connection is reconnecting for a specific clientId
 */
export const selectIsRemoteReconnecting = (clientId: string) =>
  createSelector(selectRemoteConnectionState(clientId), (connection) => connection?.reconnecting ?? false);

/**
 * Select the last error for a remote connection for a specific clientId
 */
export const selectRemoteConnectionError = (clientId: string) =>
  createSelector(selectRemoteConnectionState(clientId), (connection) => connection?.lastError ?? null);

// Forwarded events selectors
export const selectForwardedEvents = createSelector(selectSocketsState, (state) => state.forwardedEvents);

/**
 * Select forwarded events for a specific event name
 * Uses a memoized selector factory to ensure proper memoization
 */
export const selectForwardedEventsByEvent = (eventName: string) =>
  createSelector(selectForwardedEvents, (events) => {
    const filtered = events.filter((e) => e.event === eventName);

    // Return a new array reference only if the filtered result actually changed
    // This helps with distinctUntilChanged in observables
    return filtered;
  });

/**
 * Select the most recent forwarded event
 */
export const selectMostRecentForwardedEvent = createSelector(selectForwardedEvents, (events) =>
  events.length > 0 ? events[events.length - 1] : null,
);

/**
 * Select the most recent forwarded event for a specific event name
 */
export const selectMostRecentForwardedEventByEvent = (eventName: string) =>
  createSelector(selectForwardedEvents, (events) => {
    const filtered = events.filter((e) => e.event === eventName);

    return filtered.length > 0 ? filtered[filtered.length - 1] : null;
  });

/**
 * Select the currently selected agent ID (from loginSuccess)
 */
export const selectSelectedAgentId = createSelector(selectSocketsState, (state) => state.selectedAgentId);

// Message filter results selectors
export const selectMessageFilterResults = createSelector(selectSocketsState, (state) => state.messageFilterResults);

/**
 * Select message filter results for a specific direction and message timestamp
 * Matches filter results to messages by finding the closest filter result timestamp
 */
export const selectFilterResultForMessage = (direction: 'incoming' | 'outgoing', messageTimestamp: number) =>
  createSelector(selectMessageFilterResults, (filterResults) => {
    // Find filter results matching the direction
    const matchingDirection = filterResults.filter((fr) => fr.direction === direction);

    if (matchingDirection.length === 0) {
      return null;
    }

    // Find the filter result with timestamp closest to the message timestamp
    // Allow a small time window (e.g., 5 seconds) for matching
    const TIME_WINDOW_MS = 5000;
    const candidates = matchingDirection.filter((fr) => Math.abs(fr.timestamp - messageTimestamp) <= TIME_WINDOW_MS);

    if (candidates.length === 0) {
      return null;
    }

    // Return the closest match
    return candidates.reduce((closest, current) =>
      Math.abs(current.timestamp - messageTimestamp) < Math.abs(closest.timestamp - messageTimestamp)
        ? current
        : closest,
    );
  });

export type ChatTimelineOrderedRow = {
  event: string;
  payload: import('./sockets.types').ForwardedEventPayload;
  timestamp: number;
  semanticTimestamp: number;
};

function semanticSortKey(row: { event: string; payload: unknown; timestamp: number }): number {
  if (row.event === 'chatMessage' && row.payload && typeof row.payload === 'object' && 'success' in row.payload) {
    const envelope = row.payload as { success?: boolean; data?: ChatMessageData };

    if (envelope.success && envelope.data?.timestamp) {
      const t = Date.parse(envelope.data.timestamp);

      if (!Number.isNaN(t)) {
        return t;
      }
    }
  }

  if (row.event === CLIENT_CHAT_AUTOMATION_SOCKET_EVENT) {
    const p = row.payload as TicketAutomationRunChatEventPayload | undefined;

    if (p?.timelineAt) {
      const t = Date.parse(p.timelineAt);

      if (!Number.isNaN(t)) {
        return t;
      }
    }
  }

  return row.timestamp;
}

/**
 * Chat messages merged with ticket automation chat events, ordered by semantic time.
 * Automation rows are deduped by `run.id` (latest `timelineAt` wins). Filtered to `run.agentId === selectedAgentId` when an agent is selected.
 */
export const selectChatTimelineOrdered = createSelector(
  selectForwardedEvents,
  selectSelectedAgentId,
  (events, selectedAgentId): ChatTimelineOrderedRow[] => {
    const chatMsgs = events.filter((e) => e.event === 'chatMessage');
    const rawAuto = events.filter((e) => e.event === CLIENT_CHAT_AUTOMATION_SOCKET_EVENT);
    const byRun = new Map<string, (typeof events)[0]>();

    for (const e of rawAuto) {
      const run = (e.payload as TicketAutomationRunChatEventPayload | undefined)?.run;

      if (!run?.id || !run.agentId) {
        continue;
      }

      if (selectedAgentId && run.agentId !== selectedAgentId) {
        continue;
      }

      const prev = byRun.get(run.id);

      if (!prev) {
        byRun.set(run.id, e);
        continue;
      }

      const prevT = semanticSortKey(prev);
      const curT = semanticSortKey(e);

      if (curT >= prevT) {
        byRun.set(run.id, e);
      }
    }

    const automations = [...byRun.values()];
    const merged: ChatTimelineOrderedRow[] = [...chatMsgs, ...automations].map((e) => ({
      ...e,
      semanticTimestamp: semanticSortKey(e),
    }));

    merged.sort((a, b) => a.semanticTimestamp - b.semanticTimestamp || a.timestamp - b.timestamp);

    return merged;
  },
);
