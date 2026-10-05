import type { ChatPlanPhase, ChatPlanStatus } from '../../entities/chat-plan.enums';
import type { ChatPlanContextInjectionJson } from '../../entities/chat-plan.entity';

export class ChatPlanResponseDto {
  id!: string;
  clientId!: string;
  agentId!: string;
  chatId!: string;
  status!: ChatPlanStatus;
  phase!: ChatPlanPhase;
  sourcePrompt!: string;
  planMarkdown!: string | null;
  summary!: string | null;
  contextInjection!: ChatPlanContextInjectionJson | null;
  model!: string | null;
  resumeSessionSuffix!: string;
  completionSignalSeen!: boolean;
  failureCode!: string | null;
  failureMessage!: string | null;
  createdByUserId!: string | null;
  startedAt!: Date;
  finishedAt!: Date | null;
  createdAt!: Date;
  updatedAt!: Date;
}
