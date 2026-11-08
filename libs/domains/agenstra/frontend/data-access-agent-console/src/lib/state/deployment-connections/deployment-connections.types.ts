import type {
  ConnectionAuthType,
  DeploymentConnectionWorkspaceAccess,
  DeploymentProvider,
} from '@forepath/agenstra/shared/util-opencode-config';

/**
 * Instance-wide CI/CD connections (admin, agent-controller `/connections/deployments`). The response / result shapes
 * (`DeploymentConnectionSummary`, `ConnectionTestResult`) come from `@forepath/agenstra/shared/util-opencode-config`.
 */

/** Rows per page of the admin connections table (the API default is 10, like Atlassian connections). */
export const DEPLOYMENT_CONNECTIONS_DEFAULT_LIMIT = 10;

export interface DeploymentConnectionsQuery {
  search?: string;
  provider?: DeploymentProvider | null;
  limit?: number;
  offset?: number;
}

/**
 * `POST /connections/deployments`. Secrets (`token`, `privateKey`) are write-only: they are never returned and, on
 * update, omitted secrets keep the stored ones (switching `authType` requires the secrets of the new type).
 */
export interface CreateDeploymentConnectionDto {
  label: string;
  provider: DeploymentProvider;
  /** Required for Jenkins; optional for GitHub Enterprise (`https://host/api/v3`) and GitLab self-managed. */
  baseUrl?: string | null;
  /** Defaults to the provider default (`DEPLOYMENT_PROVIDER_AUTH_TYPES[provider][0]`). */
  authType?: ConnectionAuthType;
  token?: string;
  username?: string;
  appId?: string;
  installationId?: string;
  privateKey?: string;
  workspaceAccess?: DeploymentConnectionWorkspaceAccess;
  allowedClientIds?: string[];
}

/** `PUT /connections/deployments/:id` (all optional; the provider is immutable). */
export type UpdateDeploymentConnectionDto = Partial<Omit<CreateDeploymentConnectionDto, 'provider'>>;
