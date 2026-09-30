import type {
  AgentEventEnvelope,
  ChatMessageData,
  ForwardedEventPayload,
  MessageFilterResultData,
  SuccessResponse,
  TicketAutomationRunChatEventPayload,
} from '../container-socket/container-socket.types';

export type {
  AgentEventEnvelope,
  ChatMessageData,
  ForwardedEventPayload,
  MessageFilterResultData,
  SuccessResponse,
  TicketAutomationRunChatEventPayload,
};

/** Batch restore/live message row may carry a persisted entity id. */
export type ChatTimelineBatchMessage = ChatMessageData & { id?: string };

export interface ChatTimelineMessageRow {
  id: string | null;
  event: 'chatMessage';
  payload: SuccessResponse<ChatMessageData>;
  timestamp: number;
  chatId?: string;
}

export interface ChatTimelineEventRow {
  event: 'chatEvent';
  payload: SuccessResponse<AgentEventEnvelope>;
  timestamp: number;
  chatId?: string;
}

export interface ChatTimelineFilterResult {
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
  timestamp: number;
  receivedAt: number;
  chatId?: string;
}

export interface ChatTimelineAutomationRow {
  event: string;
  payload: TicketAutomationRunChatEventPayload;
  timestamp: number;
}

export interface ChatTimelineCorrelationResult {
  correlationId: string;
  success: boolean;
  enhancedText?: string;
  errorMessage?: string;
}
