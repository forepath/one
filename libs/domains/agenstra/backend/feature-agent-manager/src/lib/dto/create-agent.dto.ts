import { AGENT_HANDOFF_LIMITS } from '@forepath/agenstra/shared/util-opencode-config';
import { IsEnum, IsIn, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

import { ISOLATION_LEVELS, type IsolationLevel } from '../constants/container-isolation.constants';
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
   * Effective egress policy (set by the agent controller from the layered agent configuration).
   * When it requires filtering, the egress guard is provisioned and its policy applied before the
   * agent container starts, so the environment never runs without enforcement.
   */
  @IsOptional()
  @IsObject({ message: 'Egress policy must be an object' })
  egressPolicy?: Record<string, unknown>;

  /**
   * Container isolation level (`sandboxed` = gVisor, `standard` = runc). When omitted, the strongest
   * level that is ready on the agent manager host is used. An explicit level is never replaced by
   * another one: an unavailable level is rejected.
   */
  @IsOptional()
  @IsIn([...ISOLATION_LEVELS], { message: 'Isolation level must be one of: standard, sandboxed' })
  isolationLevel?: IsolationLevel;

  /**
   * Host isolation capability revision the selection was made against. When set and the host's
   * capabilities changed in the meantime, the request is rejected as stale.
   */
  @IsOptional()
  @IsString({ message: 'Capability revision must be a string' })
  @MaxLength(128, { message: 'Capability revision must not exceed 128 characters' })
  capabilityRevision?: string;

  /**
   * Selection metadata (set by the agent controller; e.g. the selecting user). Every other field of
   * the persisted selection record is derived by the agent manager.
   */
  @IsOptional()
  @IsObject({ message: 'Isolation selection must be an object' })
  isolationSelection?: Record<string, unknown>;

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
