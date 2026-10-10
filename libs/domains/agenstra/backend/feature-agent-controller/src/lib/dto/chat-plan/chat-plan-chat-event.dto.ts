import type { ChatPlanResponseDto } from './chat-plan-response.dto';

export type ChatPlanChatActionType = 'openChatPlan' | 'executeChatPlan' | 'retryChatPlan' | 'cancelChatPlan';

export interface ChatPlanChatOpenActionDto {
  type: 'openChatPlan';
  planId: string;
  chatId: string;
  label: string;
}

export interface ChatPlanChatExecuteActionDto {
  type: 'executeChatPlan';
  planId: string;
  chatId: string;
  label: string;
}

export interface ChatPlanChatRetryActionDto {
  type: 'retryChatPlan';
  planId: string;
  chatId: string;
  label: string;
}

export interface ChatPlanChatCancelActionDto {
  type: 'cancelChatPlan';
  planId: string;
  chatId: string;
  label: string;
}

export type ChatPlanChatActionDto =
  | ChatPlanChatOpenActionDto
  | ChatPlanChatExecuteActionDto
  | ChatPlanChatRetryActionDto
  | ChatPlanChatCancelActionDto;

export interface ChatPlanLiveTimelineEventDto {
  payload: unknown;
  timestamp: number;
}

/**
 * Server → client payload on namespace `clients`, event `chatPlanUpsert`.
 * `timelineAt` is ISO-8601: hydrate rows use `plan.startedAt`; live updates use `plan.updatedAt`.
 */
export interface ChatPlanChatEventDto {
  timelineAt: string;
  hydrate: boolean;
  plan: ChatPlanResponseDto;
  actions: ChatPlanChatActionDto[];
  timelineEvents?: ChatPlanLiveTimelineEventDto[];
}
