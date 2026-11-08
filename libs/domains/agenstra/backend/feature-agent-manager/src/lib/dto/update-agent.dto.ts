import { AGENT_HANDOFF_LIMITS } from '@forepath/agenstra/shared/util-opencode-config';
import { IsIn, IsOptional, MaxLength, IsString } from 'class-validator';

/**
 * DTO for updating an existing agent.
 * All fields are optional to support partial updates.
 * Note: Password cannot be updated after creation.
 */
export class UpdateAgentDto {
  @IsOptional()
  @IsString({ message: 'Name must be a string' })
  name?: string;

  @IsOptional()
  @IsString({ message: 'Description must be a string' })
  description?: string;

  /** Responsibilities and what the environment can take over from other agents of the workspace (handoffs). */
  @IsOptional()
  @IsString({ message: 'Handoff profile must be a string' })
  @MaxLength(AGENT_HANDOFF_LIMITS.profileMaxLength, {
    message: `Handoff profile must be at most ${AGENT_HANDOFF_LIMITS.profileMaxLength} characters`,
  })
  handoffProfile?: string;

  @IsOptional()
  @IsString({ message: 'Agent type must be a string' })
  @IsIn(['opencode'], { message: 'Agent type must be one of: opencode' })
  agentType?: string;
}
