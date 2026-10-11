import { createAction, props } from '@ngrx/store';

import type {
  AgentEventEnvelope,
  ChatPlanChatEventPayload,
  ChatTimelineBatchMessage,
  ChatTimelineCorrelationResult,
  ChatTimelineFilterResult,
  MessageFilterResultData,
  SuccessResponse,
  TicketAutomationRunChatEventPayload,
} from './chat-timeline.types';

export const chatTimelineClear = createAction('[Chat Timeline] Clear');

export const chatTimelineRestoreRequested = createAction(
  '[Chat Timeline] Restore Requested',
  props<{ older: boolean }>(),
);

export const chatTimelineBatchReceived = createAction(
  '[Chat Timeline] Batch Received',
  props<{
    chatId: string;
    messages: ChatTimelineBatchMessage[];
    filterResults?: MessageFilterResultData[] | ChatTimelineFilterResult[];
    events?: Array<SuccessResponse<AgentEventEnvelope>>;
    hasMoreOlder: boolean;
    replace: boolean;
    oldestMessageId?: string | null;
  }>(),
);

export const chatTimelineMessageReceived = createAction(
  '[Chat Timeline] Message Received',
  props<{ payload: SuccessResponse<import('./chat-timeline.types').ChatMessageData>; chatId?: string }>(),
);

export const chatTimelineEventReceived = createAction(
  '[Chat Timeline] Event Received',
  props<{ payload: SuccessResponse<AgentEventEnvelope>; chatId?: string }>(),
);

export const chatTimelineFilterReceived = createAction(
  '[Chat Timeline] Filter Received',
  props<{ payload: SuccessResponse<MessageFilterResultData>; chatId?: string }>(),
);

export const chatTimelineAutomationUpsert = createAction(
  '[Chat Timeline] Automation Upsert',
  props<{ payload: TicketAutomationRunChatEventPayload }>(),
);

export const chatTimelinePlanUpsert = createAction(
  '[Chat Timeline] Plan Upsert',
  props<{ payload: ChatPlanChatEventPayload }>(),
);

export const chatTimelineRestoreSuccess = createAction(
  '[Chat Timeline] Restore Success',
  props<{
    chatId: string;
    hasMoreOlder: boolean;
    oldestMessageId?: string | null;
    messageCount?: number;
  }>(),
);

export const chatEnhancementStarted = createAction(
  '[Chat Timeline] Chat Enhancement Started',
  props<{ correlationId: string }>(),
);

export const ticketBodyGenerationStarted = createAction(
  '[Chat Timeline] Ticket Body Generation Started',
  props<{ correlationId: string }>(),
);

export const chatTimelineEnhanceResult = createAction(
  '[Chat Timeline] Enhance Result',
  props<ChatTimelineCorrelationResult>(),
);

export const chatTimelineTicketBodyResult = createAction(
  '[Chat Timeline] Ticket Body Result',
  props<ChatTimelineCorrelationResult>(),
);

export const chatTimelineForwardEnhanceFailure = createAction(
  '[Chat Timeline] Forward Enhance Failure',
  props<{ errorMessage: string }>(),
);

export const chatTimelineForwardTicketBodyFailure = createAction(
  '[Chat Timeline] Forward Ticket Body Failure',
  props<{ errorMessage: string }>(),
);
