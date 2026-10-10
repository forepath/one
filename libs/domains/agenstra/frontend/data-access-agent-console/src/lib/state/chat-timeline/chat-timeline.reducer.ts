import { createReducer, on } from '@ngrx/store';

import { CLIENT_CHAT_AUTOMATION_SOCKET_EVENT } from '../container-socket/client-chat-automation.constants';
import { CLIENT_CHAT_PLAN_SOCKET_EVENT } from '../container-socket/client-chat-plan.constants';

import {
  chatEnhancementStarted,
  chatTimelineAutomationUpsert,
  chatTimelineBatchReceived,
  chatTimelineClear,
  chatTimelineEnhanceResult,
  chatTimelineEventReceived,
  chatTimelineFilterReceived,
  chatTimelineForwardEnhanceFailure,
  chatTimelineForwardTicketBodyFailure,
  chatTimelineMessageReceived,
  chatTimelinePlanUpsert,
  chatTimelineRestoreRequested,
  chatTimelineRestoreSuccess,
  chatTimelineTicketBodyResult,
  ticketBodyGenerationStarted,
} from './chat-timeline.actions';
import type {
  AgentEventEnvelope,
  ChatMessageData,
  ChatPlanChatEventPayload,
  ChatTimelineAutomationRow,
  ChatTimelineBatchMessage,
  ChatTimelineCorrelationResult,
  ChatTimelineEventRow,
  ChatTimelineFilterResult,
  ChatTimelineMessageRow,
  ChatTimelinePlanRow,
  MessageFilterResultData,
  SuccessResponse,
  TicketAutomationRunChatEventPayload,
} from './chat-timeline.types';

export interface ChatTimelineState {
  messages: ChatTimelineMessageRow[];
  events: ChatTimelineEventRow[];
  filterResults: ChatTimelineFilterResult[];
  automations: ChatTimelineAutomationRow[];
  plans: ChatTimelinePlanRow[];
  hasMoreOlder: boolean;
  oldestMessageId: string | null;
  loadingInitial: boolean;
  loadingOlder: boolean;
  error: string | null;
  chatEnhancementPendingCorrelationId: string | null;
  chatEnhancementLastResult: ChatTimelineCorrelationResult | null;
  ticketBodyPendingCorrelationId: string | null;
  ticketBodyLastResult: ChatTimelineCorrelationResult | null;
}

export const initialChatTimelineState: ChatTimelineState = {
  messages: [],
  events: [],
  filterResults: [],
  automations: [],
  plans: [],
  hasMoreOlder: false,
  oldestMessageId: null,
  loadingInitial: false,
  loadingOlder: false,
  error: null,
  chatEnhancementPendingCorrelationId: null,
  chatEnhancementLastResult: null,
  ticketBodyPendingCorrelationId: null,
  ticketBodyLastResult: null,
};

function parseTimestamp(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Date.parse(value);

  return Number.isNaN(parsed) ? fallback : parsed;
}

function extractMessageId(data: ChatTimelineBatchMessage | ChatMessageData): string | null {
  if (data && typeof data === 'object' && 'id' in data && typeof (data as { id?: unknown }).id === 'string') {
    const id = (data as { id: string }).id.trim();

    return id.length > 0 ? id : null;
  }

  return null;
}

function toMessageRow(data: ChatTimelineBatchMessage, chatId: string, receivedAt: number): ChatTimelineMessageRow {
  const id = extractMessageId(data);
  const rowChatId = data.chatId ?? chatId;
  const timestamp = parseTimestamp(data.timestamp, receivedAt);

  return {
    id,
    event: 'chatMessage',
    payload: {
      success: true,
      data,
      timestamp: data.timestamp,
    },
    timestamp,
    chatId: rowChatId,
  };
}

function toEventRow(
  payload: SuccessResponse<AgentEventEnvelope>,
  chatId: string | undefined,
  receivedAt: number,
): ChatTimelineEventRow {
  const rowChatId = chatId ?? payload.data?.chatId;
  const timestamp = parseTimestamp(payload.data?.timestamp ?? payload.timestamp, receivedAt);

  return {
    event: 'chatEvent',
    payload,
    timestamp,
    ...(rowChatId ? { chatId: rowChatId } : {}),
  };
}

function toFilterResult(
  data: MessageFilterResultData | ChatTimelineFilterResult,
  chatId: string | undefined,
  receivedAt: number,
): ChatTimelineFilterResult {
  const timestamp =
    typeof data.timestamp === 'number' ? data.timestamp : parseTimestamp(String(data.timestamp), receivedAt);

  return {
    direction: data.direction,
    status: data.status,
    message: data.message,
    appliedFilters: data.appliedFilters,
    matchedFilter: data.matchedFilter,
    action: data.action,
    timestamp,
    receivedAt: 'receivedAt' in data && typeof data.receivedAt === 'number' ? data.receivedAt : receivedAt,
    ...(chatId ? { chatId } : {}),
  };
}

function prependMessagesById(
  existing: ChatTimelineMessageRow[],
  incoming: ChatTimelineMessageRow[],
): ChatTimelineMessageRow[] {
  const existingIds = new Set(existing.map((row) => row.id).filter((id): id is string => !!id));
  const uniqueIncoming = incoming.filter((row) => !row.id || !existingIds.has(row.id));

  return [...uniqueIncoming, ...existing];
}

function upsertMessageById(
  existing: ChatTimelineMessageRow[],
  incoming: ChatTimelineMessageRow,
): ChatTimelineMessageRow[] {
  if (!incoming.id) {
    return [...existing, incoming];
  }

  const index = existing.findIndex((row) => row.id === incoming.id);

  if (index < 0) {
    return [...existing, incoming];
  }

  const next = [...existing];

  next[index] = incoming;

  return next;
}

function upsertAutomation(
  existing: ChatTimelineAutomationRow[],
  payload: TicketAutomationRunChatEventPayload,
): ChatTimelineAutomationRow[] {
  const runId = payload.run?.id;
  const timestamp = parseTimestamp(payload.timelineAt, Date.now());
  const row: ChatTimelineAutomationRow = {
    event: CLIENT_CHAT_AUTOMATION_SOCKET_EVENT,
    payload,
    timestamp,
  };

  if (!runId) {
    return [...existing, row];
  }

  const index = existing.findIndex((item) => item.payload.run?.id === runId);

  if (index < 0) {
    return [...existing, row];
  }

  const next = [...existing];

  next[index] = row;

  return next;
}

function upsertPlan(existing: ChatTimelinePlanRow[], payload: ChatPlanChatEventPayload): ChatTimelinePlanRow[] {
  const planId = payload.plan?.id;
  const timestamp = parseTimestamp(payload.timelineAt, Date.now());
  const row: ChatTimelinePlanRow = {
    event: CLIENT_CHAT_PLAN_SOCKET_EVENT,
    payload,
    timestamp,
  };

  if (!planId) {
    return [...existing, row];
  }

  const index = existing.findIndex((item) => item.payload.plan?.id === planId);

  if (index < 0) {
    return [...existing, row];
  }

  const next = [...existing];

  next[index] = row;

  return next;
}

export const chatTimelineReducer = createReducer(
  initialChatTimelineState,
  on(chatTimelineClear, () => ({ ...initialChatTimelineState })),
  on(chatTimelineRestoreRequested, (state, { older }) => ({
    ...state,
    loadingInitial: older ? state.loadingInitial : true,
    loadingOlder: older ? true : state.loadingOlder,
    error: null,
  })),
  on(
    chatTimelineBatchReceived,
    (state, { chatId, messages, filterResults, events, hasMoreOlder, replace, oldestMessageId }) => {
      const receivedAt = Date.now();
      const messageRows = messages.map((message) => toMessageRow(message, chatId, receivedAt));
      const eventRows = (events ?? []).map((payload) => toEventRow(payload, chatId, receivedAt));
      const filterRows = (filterResults ?? []).map((result) => toFilterResult(result, chatId, receivedAt));

      if (replace) {
        return {
          ...state,
          messages: messageRows,
          events: eventRows,
          filterResults: filterRows,
          hasMoreOlder,
          oldestMessageId: oldestMessageId ?? messageRows[0]?.id ?? null,
          loadingInitial: false,
          loadingOlder: false,
          error: null,
        };
      }

      return {
        ...state,
        messages: prependMessagesById(state.messages, messageRows),
        events: [...eventRows, ...state.events],
        filterResults: [...filterRows, ...state.filterResults],
        hasMoreOlder,
        oldestMessageId: oldestMessageId ?? messageRows[0]?.id ?? state.oldestMessageId,
        loadingInitial: false,
        loadingOlder: false,
        error: null,
      };
    },
  ),
  on(chatTimelineMessageReceived, (state, { payload, chatId }) => {
    const receivedAt = Date.now();
    const data = payload.data as ChatTimelineBatchMessage;
    const rowChatId = chatId ?? data.chatId;
    const row = toMessageRow(
      {
        ...data,
        ...(rowChatId ? { chatId: rowChatId } : {}),
      },
      rowChatId ?? '',
      parseTimestamp(payload.timestamp, receivedAt),
    );

    return {
      ...state,
      messages: upsertMessageById(state.messages, row),
      error: null,
    };
  }),
  on(chatTimelineEventReceived, (state, { payload, chatId }) => {
    const row = toEventRow(payload, chatId, Date.now());

    return {
      ...state,
      events: [...state.events, row],
    };
  }),
  on(chatTimelineFilterReceived, (state, { payload, chatId }) => {
    const row = toFilterResult(payload.data, chatId, Date.now());

    return {
      ...state,
      filterResults: [...state.filterResults, row],
    };
  }),
  on(chatTimelineAutomationUpsert, (state, { payload }) => ({
    ...state,
    automations: upsertAutomation(state.automations, payload),
  })),
  on(chatTimelinePlanUpsert, (state, { payload }) => ({
    ...state,
    plans: upsertPlan(state.plans, payload),
  })),
  on(chatTimelineRestoreSuccess, (state, { hasMoreOlder, oldestMessageId }) => ({
    ...state,
    hasMoreOlder,
    oldestMessageId: oldestMessageId ?? state.oldestMessageId,
    loadingInitial: false,
    loadingOlder: false,
    error: null,
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
  on(chatTimelineEnhanceResult, (state, result) => {
    if (
      state.chatEnhancementPendingCorrelationId &&
      result.correlationId !== state.chatEnhancementPendingCorrelationId
    ) {
      return state;
    }

    return {
      ...state,
      chatEnhancementPendingCorrelationId: null,
      chatEnhancementLastResult: {
        correlationId: result.correlationId,
        success: result.success,
        enhancedText: result.enhancedText,
        errorMessage: result.errorMessage,
      },
    };
  }),
  on(chatTimelineTicketBodyResult, (state, result) => {
    if (state.ticketBodyPendingCorrelationId && result.correlationId !== state.ticketBodyPendingCorrelationId) {
      return state;
    }

    return {
      ...state,
      ticketBodyPendingCorrelationId: null,
      ticketBodyLastResult: {
        correlationId: result.correlationId,
        success: result.success,
        enhancedText: result.enhancedText,
        errorMessage: result.errorMessage,
      },
    };
  }),
  on(chatTimelineForwardEnhanceFailure, (state, { errorMessage }) => {
    if (!state.chatEnhancementPendingCorrelationId) {
      return state;
    }

    return {
      ...state,
      chatEnhancementPendingCorrelationId: null,
      chatEnhancementLastResult: {
        correlationId: state.chatEnhancementPendingCorrelationId,
        success: false,
        errorMessage,
      },
    };
  }),
  on(chatTimelineForwardTicketBodyFailure, (state, { errorMessage }) => {
    if (!state.ticketBodyPendingCorrelationId) {
      return state;
    }

    return {
      ...state,
      ticketBodyPendingCorrelationId: null,
      ticketBodyLastResult: {
        correlationId: state.ticketBodyPendingCorrelationId,
        success: false,
        errorMessage,
      },
    };
  }),
);
