import { ConfigResponseDto } from '@forepath/agenstra/backend/feature-agent-manager';
import { AuthenticationType } from '@forepath/identity/backend';

import type { ClientIsolationSummaryDto } from './client-isolation.dto';

/**
 * DTO for client API responses.
 * Excludes sensitive information like API key.
 */
export class ClientResponseDto {
  id!: string;
  name!: string;
  description?: string;
  endpoint!: string;
  authenticationType!: AuthenticationType;
  config?: ConfigResponseDto;
  /** Container isolation levels of the workspace host (recommendation, ready levels, revision). */
  isolation?: ClientIsolationSummaryDto;
  isAutoProvisioned!: boolean;
  /** True if the current viewer may change autonomy, env vars, agents, and workspace (client) settings. */
  canManageWorkspaceConfiguration!: boolean;
  createdAt!: Date;
  updatedAt!: Date;
}
