import { IsBoolean, IsEnum, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

import { GitRepositorySetupMode } from '../constants/git-repository-setup-mode';
import { ContainerType } from '../entities/agent.entity';

/**
 * DTO for creating a new agent.
 * Password is auto-generated and returned in the response.
 */
export class CreateAgentDto {
  @IsNotEmpty({ message: 'Name is required' })
  @IsString({ message: 'Name must be a string' })
  name!: string;

  @IsOptional()
  @IsString({ message: 'Description must be a string' })
  description?: string;

  @IsOptional()
  @IsString({ message: 'Agent type must be a string' })
  @IsIn(['cursor', 'opencode', 'openclaw'], { message: 'Agent type must be one of: cursor, opencode, openclaw' })
  agentType?: string;

  @IsOptional()
  @IsEnum(ContainerType, { message: 'Container type must be one of: generic, docker, terraform, kubernetes' })
  containerType?: ContainerType = ContainerType.GENERIC;

  @IsOptional()
  @IsEnum(GitRepositorySetupMode, {
    message: 'Git repository setup mode must be one of: clone, empty',
  })
  gitRepositorySetupMode?: GitRepositorySetupMode;

  @IsOptional()
  @IsString({ message: 'Git repository URL must be a string' })
  gitRepositoryUrl?: string;

  /**
   * Deploy the virtual workspace sidecar and enable browser-only Preview (CDP).
   * Forced on when createVirtualWorkspace is true. Defaults to true.
   */
  @IsOptional()
  @IsBoolean({ message: 'Create browser preview must be a boolean' })
  createBrowserPreview?: boolean = true;

  /**
   * Publish full noVNC desktop access. Implies createBrowserPreview.
   * Defaults to true in the DTO; the agent console UI defaults to false.
   */
  @IsOptional()
  @IsBoolean({ message: 'Create virtual workspace must be a boolean' })
  createVirtualWorkspace?: boolean = true;

  @IsOptional()
  @IsBoolean({ message: 'Create SSH connection must be a boolean' })
  createSshConnection?: boolean = true;

  /**
   * CI/CD deployment configuration (optional).
   * If provided, a deployment configuration will be created for this agent.
   */
  @IsOptional()
  deploymentConfiguration?: {
    providerType: string;
    repositoryId: string;
    defaultBranch?: string;
    workflowId?: string;
    providerToken: string;
    providerBaseUrl?: string;
  };
}
