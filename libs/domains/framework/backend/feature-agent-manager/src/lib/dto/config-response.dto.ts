/**
 * Agent type information with identifier and display name.
 */
export class AgentTypeInfo {
  /**
   * The unique type identifier (e.g., 'cursor', 'openai', 'anthropic')
   */
  type!: string;

  /**
   * Human-readable display name (e.g., 'Cursor', 'OpenAI', 'Anthropic Claude')
   */
  displayName!: string;
}

import { GitRepositorySetupMode } from '../constants/git-repository-setup-mode';

/**
 * DTO for configuration API responses.
 * Contains configuration parameters exposed to clients.
 */
export class ConfigResponseDto {
  gitRepositoryUrl?: string;
  gitRepositorySetupMode?: GitRepositorySetupMode;
  agentTypes!: AgentTypeInfo[];
}
