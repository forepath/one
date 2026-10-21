import { AGENT_TASK_LIMITS } from '@forepath/agenstra/shared/util-opencode-config';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

import { PREFERRED_MODEL_PATTERN } from '../../utils/preferred-model.utils';

export class CreateAgentTaskDto {
  @IsString()
  @IsNotEmpty({ message: 'title is required' })
  @MaxLength(AGENT_TASK_LIMITS.titleMaxLength)
  title!: string;

  @IsString()
  @IsNotEmpty({ message: 'prompt is required' })
  @MaxLength(AGENT_TASK_LIMITS.promptMaxLength)
  prompt!: string;

  /** Five-field cron expression (minute hour day-of-month month day-of-week). */
  @IsString()
  @IsNotEmpty({ message: 'cronExpression is required' })
  @MaxLength(AGENT_TASK_LIMITS.cronExpressionMaxLength)
  cronExpression!: string;

  /** IANA time zone; defaults to UTC. */
  @IsOptional()
  @IsString()
  @MaxLength(AGENT_TASK_LIMITS.timezoneMaxLength)
  timezone?: string;

  /** OpenCode `provider/model` used for runs. */
  @IsString()
  @MaxLength(AGENT_TASK_LIMITS.modelMaxLength)
  @Matches(PREFERRED_MODEL_PATTERN)
  model!: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  /** Agents of the same workspace the runs may hand off work to (empty: no handoffs). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(AGENT_TASK_LIMITS.allowedHandoffAgentsMax)
  @IsUUID('all', { each: true })
  allowedHandoffAgentIds?: string[];
}
