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
