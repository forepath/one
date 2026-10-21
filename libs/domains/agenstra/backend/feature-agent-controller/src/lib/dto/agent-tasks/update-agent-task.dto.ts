import { AGENT_TASK_LIMITS } from '@forepath/agenstra/shared/util-opencode-config';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

import { PREFERRED_MODEL_PATTERN } from '../../utils/preferred-model.utils';

export class UpdateAgentTaskDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(AGENT_TASK_LIMITS.titleMaxLength)
  title?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(AGENT_TASK_LIMITS.promptMaxLength)
  prompt?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(AGENT_TASK_LIMITS.cronExpressionMaxLength)
  cronExpression?: string;

  @IsOptional()
  @IsString()
  @MaxLength(AGENT_TASK_LIMITS.timezoneMaxLength)
  timezone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(AGENT_TASK_LIMITS.modelMaxLength)
  @Matches(PREFERRED_MODEL_PATTERN)
  model?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
