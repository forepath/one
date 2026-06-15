import { IsEnum, IsIn, IsOptional, IsString } from 'class-validator';

import { ContainerType } from '../entities/agent.entity';

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

  @IsOptional()
  @IsString({ message: 'Agent type must be a string' })
  @IsIn(['cursor', 'opencode', 'openclaw'], { message: 'Agent type must be one of: cursor, opencode, openclaw' })
  agentType?: string;

  @IsOptional()
  @IsEnum(ContainerType, { message: 'Container type must be one of: generic, docker, terraform, kubernetes' })
  containerType?: ContainerType;

  /**
   * CI/CD deployment configuration (optional).
   * If provided, the deployment configuration for this agent will be updated or created.
   */
  @IsOptional()
  deploymentConfiguration?: {
    providerType?: string;
    repositoryId?: string;
    defaultBranch?: string;
    workflowId?: string;
    providerToken?: string;
    providerBaseUrl?: string;
  };
}
