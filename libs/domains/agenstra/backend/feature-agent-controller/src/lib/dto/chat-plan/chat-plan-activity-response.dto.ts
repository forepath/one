import type { ChatPlanActionType, ChatPlanActorType } from '../../entities/chat-plan.enums';

export class ChatPlanActivityResponseDto {
  id!: string;
  planId!: string;
  occurredAt!: Date;
  actorType!: ChatPlanActorType;
  actorUserId!: string | null;
  actorEmail!: string | null;
  actionType!: ChatPlanActionType;
  payload!: Record<string, unknown>;
}
