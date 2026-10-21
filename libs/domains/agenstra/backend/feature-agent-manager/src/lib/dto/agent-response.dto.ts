import { GitRepositorySetupMode } from '../constants/git-repository-setup-mode';
import { ContainerType } from '../entities/agent.entity';

import type { AgentEgressStatusDto } from './agent-egress.dto';
import type { AgentIsolationDto } from './container-isolation.dto';
import type { AgentChatSessionSummaryDto } from './chat-session-response.dto';
import type { AgentTypeCapabilities } from './config-response.dto';

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
  /**
   * Capabilities of the agent's provider (mirrors config agentTypes capabilities).
   */
  capabilities?: AgentTypeCapabilities;
  git?: {
    repositoryUrl?: string;
    setupMode: GitRepositorySetupMode;
  };
  /**
   * User-visible chat sessions for this environment (excludes hidden session suffixes).
   */
  chats!: AgentChatSessionSummaryDto[];
  /**
   * Id of the primary chat session for this environment.
   */
  primaryChatId!: string;
  /**
   * Egress guard (web traffic filtering) status of this environment.
   */
  egress?: AgentEgressStatusDto;
  /**
   * Container isolation level of this environment (runtime and selection record).
   */
  isolation?: AgentIsolationDto;
  createdAt!: Date;
  updatedAt!: Date;
}
