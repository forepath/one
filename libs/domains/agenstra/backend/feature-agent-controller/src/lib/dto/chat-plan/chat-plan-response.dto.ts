import type { ChatPlanContextInjectionJson } from '../../entities/chat-plan.entity';
import type { ChatPlanPhase, ChatPlanStatus } from '../../entities/chat-plan.enums';

export class ChatPlanResponseDto {
  id!: string;
  /** Context reference of the plan (`plan:<sha>`); short = first 7 characters. */
  shas!: { short: string; long: string } | null;
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
  /** First entry into `executing`; once set the plan is read-only. */
  executionStartedAt!: Date | null;
  lastEditedAt!: Date | null;
  lastEditedByUserId!: string | null;
  /** True while a workspace user may edit the plan (plans page): never executed and not being drafted by the agent. */
  editable!: boolean;
  createdAt!: Date;
  updatedAt!: Date;
}

/** Page of plans for the plans page (`total` counts every match of the filter). */
export class ChatPlanListResponseDto {
  items!: ChatPlanResponseDto[];
  total!: number;
}
