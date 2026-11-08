import type {
  ConnectionAuthType,
  DeploymentBranchSummary,
  DeploymentProvider,
  DeploymentProviderWorkflowSummary,
  DeploymentRepositorySummary,
  DeploymentRunConclusion,
  DeploymentRunJobSummary,
  DeploymentRunLogs,
  DeploymentRunStatus,
} from '@forepath/agenstra/shared/util-opencode-config';

import type { DeploymentConnectionSecrets } from '../../entities/deployment-connection.entity';

/** Decrypted connection material handed to a provider (never leaves the controller). */
export interface DeploymentProviderConnection {
  /** Connection id (cache key for minted app tokens). */
  id: string;
  provider: DeploymentProvider;
  /** Normalized API base URL (no trailing slash) or null for the provider default. */
  baseUrl: string | null;
  authType: ConnectionAuthType;
  appId: string | null;
  installationId: string | null;
  username: string | null;
  secrets: DeploymentConnectionSecrets;
}

/** Provider view of one run, normalized to the shared status / conclusion vocabulary. */
export interface DeploymentProviderRunSnapshot {
  /** Null while the provider has not assigned a run yet (e.g. GitHub dispatch without run details). */
  providerRunId: string | null;
  name: string | null;
  status: DeploymentRunStatus;
  conclusion: DeploymentRunConclusion | null;
  ref: string | null;
  sha: string | null;
  url: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
}

export interface DeploymentProviderTriggerRequest {
  repository: string;
  workflow: string | null;
  ref: string;
  inputs: Record<string, string>;
}

export interface DeploymentProviderTestResult {
  ok: boolean;
  message?: string;
}

/**
 * CI/CD provider adapter. Implementations must:
 * - URL-encode every caller supplied path segment (repository, workflow, ref, run / job ids)
 * - apply request timeouts and never include secrets in thrown messages
 * - cap returned logs to `maxBytes` (tail) and report truncation
 * - throw `BadRequestException` / `NotFoundException` / `BadGatewayException` (provider errors) from `@nestjs/common`
 */
export interface DeploymentPipelineProvider {
  readonly provider: DeploymentProvider;

  testConnection(connection: DeploymentProviderConnection): Promise<DeploymentProviderTestResult>;

  listRepositories(connection: DeploymentProviderConnection, search?: string): Promise<DeploymentRepositorySummary[]>;

  listBranches(connection: DeploymentProviderConnection, repository: string): Promise<DeploymentBranchSummary[]>;

  listWorkflows(
    connection: DeploymentProviderConnection,
    repository: string,
  ): Promise<DeploymentProviderWorkflowSummary[]>;

  trigger(
    connection: DeploymentProviderConnection,
    request: DeploymentProviderTriggerRequest,
  ): Promise<DeploymentProviderRunSnapshot>;

  getRun(
    connection: DeploymentProviderConnection,
    repository: string,
    providerRunId: string,
  ): Promise<DeploymentProviderRunSnapshot>;

  /** Recent runs of a workflow (newest first), used to sync externally started runs into the history. */
  listRuns(
    connection: DeploymentProviderConnection,
    request: { repository: string; workflow: string | null; limit: number },
  ): Promise<DeploymentProviderRunSnapshot[]>;

  listJobs(
    connection: DeploymentProviderConnection,
    repository: string,
    providerRunId: string,
  ): Promise<DeploymentRunJobSummary[]>;

  getRunLogs(
    connection: DeploymentProviderConnection,
    repository: string,
    providerRunId: string,
    maxBytes: number,
  ): Promise<DeploymentRunLogs>;

  getJobLogs(
    connection: DeploymentProviderConnection,
    repository: string,
    providerRunId: string,
    jobId: string,
    maxBytes: number,
  ): Promise<DeploymentRunLogs>;

  cancelRun(connection: DeploymentProviderConnection, repository: string, providerRunId: string): Promise<void>;
}
