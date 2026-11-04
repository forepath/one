import { IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';

import { CHAT_PLAN_LIMITS } from '../../entities/chat-plan.enums';

/**
 * User edit of a plan that has not been executed yet (plans page). `expectedUpdatedAt` is the version the user edited:
 * a plan changed in between (agent refine, another user, execution) is refused with 409.
 */
export class UpdateChatPlanDto {
  @IsOptional()
  @IsString()
  @MaxLength(CHAT_PLAN_LIMITS.planMarkdownMaxLength)
  planMarkdown?: string;

  /** Plan title; empty clears it (the original request is shown instead). */
  @IsOptional()
  @IsString()
  @MaxLength(CHAT_PLAN_LIMITS.summaryMaxLength)
  summary?: string;

  @IsISO8601()
  expectedUpdatedAt!: string;
}
