import { createReducer, on } from '@ngrx/store';

import {
  CLIENT_CHAT_AUTOMATION_SOCKET_EVENT,
  CLIENT_CHAT_TICKET_UPSERT_SOCKET_EVENT,
} from './client-chat-automation.constants';
import {
  chatEnhancementStarted,
  ticketBodyGenerationStarted,
  clearChatHistory,
  connectSocket,
  connectSocketFailure,
  connectSocketSuccess,
  disconnectSocket,
  disconnectSocketSuccess,
  forwardedEventReceived,
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
} from './sockets.actions';
import { ForwardableEvent, type AgentResponseMode } from './sockets.types';

export interface RemoteConnectionState {
  clientId: string;
  connected: boolean;
  reconnecting: boolean;
  reconnectAttempts: number;
  lastError: string | null;
}

export interface SocketsState {
  // Main socket connection state (to clients.gateway)
  connected: boolean;
  connecting: boolean;
  disconnecting: boolean;
  reconnecting: boolean; // Main socket reconnecting
  reconnectAttempts: number;
  selectedClientId: string | null;
  chatModel: string | null;
  /** How agent-manager runs the turn: incremental `chatEvent` vs one-shot `chatMessage`. */
  chatResponseMode: AgentResponseMode;
  forwarding: boolean;
  forwardingEvent: string | null; // Track which event is currently being forwarded
  error: string | null;
  // Track forwarded events received from remote agents namespace
  forwardedEvents: Array<{
    event: string;
    payload: import('./sockets.types').ForwardedEventPayload;
    timestamp: number;
  }>;
  // Track message filter results keyed by direction and timestamp (for matching to messages)
  messageFilterResults: Array<{
    direction: 'incoming' | 'outgoing';
    status: 'allowed' | 'filtered' | 'dropped';
    message: string;
    appliedFilters: Array<{
      type: string;
      displayName: string;
      matched: boolean;
      reason?: string;
    }>;
    matchedFilter?: {
      type: string;
      displayName: string;
      matched: boolean;
      reason?: string;
    };
    action?: 'drop' | 'flag';
    timestamp: number; // When filter was applied (from payload timestamp)
    receivedAt: number; // When event was received (Date.now())
  }>;
  // Track currently selected agent ID (for associating stats with agent)
  selectedAgentId: string | null;
  // Track setClient operation in progress to prevent duplicate calls
  settingClient: boolean;
  settingClientId: string | null; // Track which clientId is being set
  // Per-clientId remote connection state (clients.gateway -> agents.gateway)
  remoteConnections: Record<string, RemoteConnectionState>;
  // Maximum number of entries to keep (to prevent memory issues)
  maxForwardedEvents: number;
  maxMessageFilterResults: number;
  chatEnhancementPendingCorrelationId: string | null;
  chatEnhancementLastResult: {
    correlationId: string;
    success: boolean;
    enhancedText?: string;
    errorMessage?: string;
  } | null;
  ticketBodyPendingCorrelationId: string | null;
  ticketBodyLastResult: {
    correlationId: string;
    success: boolean;
    enhancedText?: string;
    errorMessage?: string;
  } | null;
}

export const initialSocketsState: SocketsState = {
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
  forwardedEvents: [],
  messageFilterResults: [],
  selectedAgentId: null,
  settingClient: false,
  settingClientId: null,
  remoteConnections: {},
  maxForwardedEvents: 1000,
  maxMessageFilterResults: 1000,
  chatEnhancementPendingCorrelationId: null,
  chatEnhancementLastResult: null,
  ticketBodyPendingCorrelationId: null,
  ticketBodyLastResult: null,
};

export const socketsReducer = createReducer(
  initialSocketsState,
  // Connect Socket
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
  // Main Socket Reconnection
  on(socketReconnecting, (state, { attempt }) => ({
    ...state,
    reconnecting: true,
    reconnectAttempts: attempt,
    // Don't set error while reconnecting - only show error if reconnect fails
    error: null,
  })),
  on(socketReconnected, (state) => ({
    ...state,
    connected: true,
    reconnecting: false,
    reconnectAttempts: 0,
    error: null,
    // Clear forwardedEvents on main socket reconnection to prevent duplicates
    // The backend will restore chat history when client context and login are restored
    forwardedEvents: [],
    messageFilterResults: [],
  })),
  on(socketReconnectError, (state) => ({
    ...state,
    reconnecting: true,
    // Don't set error state while still reconnecting
    // error will be set only on reconnect_failed
  })),
  on(socketReconnectFailed, (state, { error }) => ({
    ...state,
    connected: false,
    reconnecting: false,
    reconnectAttempts: 0,
    error,
  })),
  // Disconnect Socket
  on(disconnectSocket, (state) => ({
    ...state,
    disconnecting: true,
    error: null,
  })),
  on(disconnectSocketSuccess, (state) => ({
    ...state,
    connected: false,
    disconnecting: false,
    reconnecting: false,
    reconnectAttempts: 0,
    selectedClientId: null,
    error: null,
    forwardedEvents: [],
    messageFilterResults: [],
    selectedAgentId: null,
    settingClient: false,
    settingClientId: null,
    remoteConnections: {},
    chatEnhancementPendingCorrelationId: null,
    chatEnhancementLastResult: null,
    ticketBodyPendingCorrelationId: null,
    ticketBodyLastResult: null,
  })),
  // Set Client
  on(setClient, (state, { clientId }) => ({
    ...state,
    settingClient: true,
    settingClientId: clientId,
    error: null,
  })),
  on(setClientSuccess, (state, { clientId }) => {
    // Initialize remote connection state for this clientId if not exists
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
      // Update existing connection state
      remoteConnections[clientId] = {
        ...remoteConnections[clientId],
        connected: true,
        reconnecting: false,
        reconnectAttempts: 0,
        lastError: null,
      };
    }

    // If this is a reconnection (clientId matches the previously selected client),
    // clear forwardedEvents to prevent duplicates when chat history is restored
    // This ensures old messages are cleared before restored messages are loaded
    const isReconnection = state.selectedClientId === clientId && state.forwardedEvents.length > 0;

    return {
      ...state,
      selectedClientId: clientId,
      settingClient: false,
      settingClientId: null,
      error: null,
      remoteConnections,
      // Clear forwardedEvents on reconnection to prevent duplicates
      // The backend will restore chat history, so we need to clear old messages first
      forwardedEvents: isReconnection ? [] : state.forwardedEvents,
      messageFilterResults: isReconnection ? [] : state.messageFilterResults,
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
  on(chatEnhancementStarted, (state, { correlationId }) => ({
    ...state,
    chatEnhancementPendingCorrelationId: correlationId,
    chatEnhancementLastResult: null,
  })),
  on(ticketBodyGenerationStarted, (state, { correlationId }) => ({
    ...state,
    ticketBodyPendingCorrelationId: correlationId,
    ticketBodyLastResult: null,
  })),
  // Forward Event
  on(forwardEvent, (state, { event }) => ({
    ...state,
    forwarding: true,
    forwardingEvent: event,
    error: null,
  })),
  on(forwardEventSuccess, (state, { event }) => {
    // Only clear forwarding if the success event matches the current forwarding event
    // This prevents clearing forwarding state when a different event succeeds
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
  on(forwardEventFailure, (state, { error }) => {
    const wasEnhance =
      state.forwardingEvent === ForwardableEvent.ENHANCE_CHAT && state.chatEnhancementPendingCorrelationId;
    const wasTicketBody =
      state.forwardingEvent === ForwardableEvent.GENERATE_TICKET_BODY && state.ticketBodyPendingCorrelationId;

    return {
      ...state,
      forwarding: false,
      forwardingEvent: null,
      error,
      ...(wasEnhance
        ? {
            chatEnhancementPendingCorrelationId: null,
            chatEnhancementLastResult: {
              correlationId: state.chatEnhancementPendingCorrelationId as string,
              success: false,
              errorMessage: error,
            },
          }
        : {}),
      ...(wasTicketBody
        ? {
            ticketBodyPendingCorrelationId: null,
            ticketBodyLastResult: {
              correlationId: state.ticketBodyPendingCorrelationId as string,
              success: false,
              errorMessage: error,
            },
          }
        : {}),
    };
  }),
  // Socket Error
  on(socketError, (state, { message }) => ({
    ...state,
    error: message,
    ...(state.chatEnhancementPendingCorrelationId
      ? {
          chatEnhancementPendingCorrelationId: null,
          chatEnhancementLastResult: {
            correlationId: state.chatEnhancementPendingCorrelationId,
            success: false,
            errorMessage: message,
          },
        }
      : {}),
    ...(state.ticketBodyPendingCorrelationId
      ? {
          ticketBodyPendingCorrelationId: null,
          ticketBodyLastResult: {
            correlationId: state.ticketBodyPendingCorrelationId,
            success: false,
            errorMessage: message,
          },
        }
      : {}),
  })),
  // Forwarded Event Received
  on(forwardedEventReceived, (state, { event, payload }) => {
    // Don't track containerStats events
    if (event === 'containerStats') {
      return state;
    }

    let chatEnhancementPendingCorrelationId = state.chatEnhancementPendingCorrelationId;
    let chatEnhancementLastResult = state.chatEnhancementLastResult;

    if (
      event === 'chatEnhanceResult' &&
      'data' in payload &&
      payload.success &&
      state.chatEnhancementPendingCorrelationId
    ) {
      const data = payload.data as import('./sockets.types').ChatEnhanceResultPayload;

      if (data.correlationId === state.chatEnhancementPendingCorrelationId) {
        chatEnhancementPendingCorrelationId = null;

        if (data.success === true) {
          chatEnhancementLastResult = {
            correlationId: data.correlationId,
            success: true,
            enhancedText: data.enhancedText,
          };
        } else {
          chatEnhancementLastResult = {
            correlationId: data.correlationId,
            success: false,
            errorMessage: data.error?.message ?? 'Enhancement failed',
          };
        }
      }
    }

    let ticketBodyPendingCorrelationId = state.ticketBodyPendingCorrelationId;
    let ticketBodyLastResult = state.ticketBodyLastResult;

    if (event === 'ticketBodyResult' && 'data' in payload && payload.success && state.ticketBodyPendingCorrelationId) {
      const data = payload.data as import('./sockets.types').TicketBodyResultPayload;

      if (data.correlationId === state.ticketBodyPendingCorrelationId) {
        ticketBodyPendingCorrelationId = null;

        if (data.success === true) {
          ticketBodyLastResult = {
            correlationId: data.correlationId,
            success: true,
            enhancedText: data.enhancedText,
          };
        } else {
          ticketBodyLastResult = {
            correlationId: data.correlationId,
            success: false,
            errorMessage: data.error?.message ?? 'Ticket body generation failed',
          };
        }
      }
    }

    // Extract agentId from loginSuccess payload to track selected agent
    let selectedAgentId = state.selectedAgentId;

    if (event === 'loginSuccess' && 'data' in payload && payload.success) {
      const loginData = payload.data as import('./sockets.types').LoginSuccessData;

      selectedAgentId = loginData.agentId;
    } else if (event === 'logoutSuccess' && 'data' in payload && payload.success) {
      const logoutData = payload.data as import('./sockets.types').LogoutSuccessData;

      // Clear selected agent if logged out
      if (logoutData.agentId === null || logoutData.agentId === state.selectedAgentId) {
        selectedAgentId = null;
      }
    }

    // Handle messageFilterResult events separately
    let messageFilterResults = state.messageFilterResults;

    if (event === 'messageFilterResult' && 'data' in payload && payload.success) {
      const filterResult = payload.data as import('./sockets.types').MessageFilterResultData;
      const updatedFilterResults = [
        ...messageFilterResults,
        {
          direction: filterResult.direction,
          status: filterResult.status,
          message: filterResult.message,
          appliedFilters: filterResult.appliedFilters,
          matchedFilter: filterResult.matchedFilter,
          action: filterResult.action,
          timestamp: new Date(filterResult.timestamp).getTime(), // Convert ISO string to timestamp
          receivedAt: Date.now(),
        },
      ];

      messageFilterResults =
        updatedFilterResults.length > state.maxMessageFilterResults
          ? updatedFilterResults.slice(-state.maxMessageFilterResults)
          : updatedFilterResults;
    }

    const skipForwardedAppend =
      event === 'chatEnhanceResult' || event === 'ticketBodyResult' || event === CLIENT_CHAT_TICKET_UPSERT_SOCKET_EVENT;
    let eventRowTimestamp = Date.now();

    if (event === CLIENT_CHAT_AUTOMATION_SOCKET_EVENT && payload && typeof payload === 'object') {
      const tl = (payload as { timelineAt?: unknown }).timelineAt;

      if (typeof tl === 'string') {
        const parsed = Date.parse(tl);

        if (!Number.isNaN(parsed)) {
          eventRowTimestamp = parsed;
        }
      }
    }

    const updatedForwardedEvents = skipForwardedAppend
      ? state.forwardedEvents
      : [...state.forwardedEvents, { event, payload, timestamp: eventRowTimestamp }];
    const trimmedForwardedEvents =
      updatedForwardedEvents.length > state.maxForwardedEvents
        ? updatedForwardedEvents.slice(-state.maxForwardedEvents)
        : updatedForwardedEvents;

    return {
      ...state,
      forwardedEvents: trimmedForwardedEvents,
      messageFilterResults,
      selectedAgentId,
      chatEnhancementPendingCorrelationId,
      chatEnhancementLastResult,
      ticketBodyPendingCorrelationId,
      ticketBodyLastResult,
    };
  }),
  // Set Agent
  on(setAgent, (state, { agentId }) => ({
    ...state,
    selectedAgentId: agentId,
  })),
  // Clear Chat History
  on(clearChatHistory, (state) => ({
    ...state,
    forwardedEvents: [],
    messageFilterResults: [],
    chatEnhancementPendingCorrelationId: null,
    chatEnhancementLastResult: null,
    ticketBodyPendingCorrelationId: null,
    ticketBodyLastResult: null,
  })),
  // Remote Connection Disconnection (per clientId)
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

    return {
      ...state,
      remoteConnections,
    };
  }),
  // Remote Connection Reconnection (per clientId)
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

    return {
      ...state,
      remoteConnections,
    };
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

    // If this is a reconnection for the selected client, clear forwardedEvents to prevent duplicates
    // The backend will restore chat history when agent logins are restored after remote reconnection
    const isReconnection = state.selectedClientId === clientId && state.forwardedEvents.length > 0;

    return {
      ...state,
      remoteConnections,
      // Clear forwardedEvents on remote reconnection to prevent duplicates
      // The backend will restore chat history when agent logins are restored
      forwardedEvents: isReconnection ? [] : state.forwardedEvents,
      messageFilterResults: isReconnection ? [] : state.messageFilterResults,
    };
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

    return {
      ...state,
      remoteConnections,
    };
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

    return {
      ...state,
      remoteConnections,
    };
  }),
);
