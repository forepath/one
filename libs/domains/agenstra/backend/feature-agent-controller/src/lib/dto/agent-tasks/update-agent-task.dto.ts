import {
  AGENT_CONTENT_WRITE_OPERATIONS,
  AGENT_DEPLOYMENT_OPERATIONS,
  AGENT_TASK_LIMITS,
  type AgentContentWriteOperation,
  type AgentDeploymentOperation,
} from '@forepath/agenstra/shared/util-opencode-config';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

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

  /** Agents of the same workspace the runs may hand off work to (empty: no handoffs). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(AGENT_TASK_LIMITS.allowedHandoffAgentsMax)
  @IsUUID('all', { each: true })
  allowedHandoffAgentIds?: string[];

  /** Ticket / knowledge changes the runs may make without asking (empty: none). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(AGENT_CONTENT_WRITE_OPERATIONS.length)
  @IsIn(AGENT_CONTENT_WRITE_OPERATIONS, { each: true })
  allowedContentWrites?: AgentContentWriteOperation[];

  /** Deployment run actions (`deployment.trigger`, `deployment.cancel`) the runs may request without asking (empty: none). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(AGENT_DEPLOYMENT_OPERATIONS.length)
  @IsIn(AGENT_DEPLOYMENT_OPERATIONS, { each: true })
  allowedDeploymentOperations?: AgentDeploymentOperation[];
}
