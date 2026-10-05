import type { ChatPlanResponseDto } from './chat-plan-response.dto';

export type ChatPlanChatActionType = 'openChatPlan' | 'executeChatPlan';

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

export type ChatPlanChatActionDto = ChatPlanChatOpenActionDto | ChatPlanChatExecuteActionDto;

/**
 * Server → client payload on namespace `clients`, event `chatPlanUpsert`.
 * `timelineAt` is ISO-8601: hydrate rows use `plan.startedAt`; live updates use `plan.updatedAt`.
 */
export interface ChatPlanChatEventDto {
  timelineAt: string;
  hydrate: boolean;
  plan: ChatPlanResponseDto;
  actions: ChatPlanChatActionDto[];
}
