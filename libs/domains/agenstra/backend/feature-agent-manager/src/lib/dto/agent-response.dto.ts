import { GitRepositorySetupMode } from '../constants/git-repository-setup-mode';
import { ContainerType } from '../entities/agent.entity';

/**
 * DTO for agent API responses.
 * Excludes sensitive information like password hash.
 */
export class AgentResponseDto {
  id!: string;
  name!: string;
  description?: string;
  agentType!: string;
  containerType!: ContainerType;
  /** Present when browser-only Preview is enabled for this agent. */
  browserPreview?: {
    enabled: true;
  };
  /** Present only when full noVNC desktop access was enabled (published host port). */
  vnc?: {
    port: number;
    password: string;
  };
  ssh?: {
    port: number;
    password: string;
  };
  git?: {
    repositoryUrl?: string;
    setupMode: GitRepositorySetupMode;
  };
  createdAt!: Date;
  updatedAt!: Date;
}
