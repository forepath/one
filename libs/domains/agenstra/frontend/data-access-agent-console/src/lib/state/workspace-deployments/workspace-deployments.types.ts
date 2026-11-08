import type {
  DeploymentRunStatus,
  DeploymentTriggerInput,
  DeploymentWorkflowApprovalStatus,
  DeploymentWorkflowScope,
} from '@forepath/agenstra/shared/util-opencode-config';

/**
 * Deployment workflows / runs of a workspace (agent-controller `/clients/:clientId/deployments`). Response shapes
 * (`DeploymentWorkflowSummary`, `DeploymentRunSummary`, `DeploymentRunDetail`, `DeploymentRunLogs`, …) come from
 * `@forepath/agenstra/shared/util-opencode-config`.
 */

/** Runs per page (API default 25, max 100). */
export const DEPLOYMENT_RUNS_DEFAULT_LIMIT = 25;

export interface DeploymentWorkflowsQuery {
  /** Workflows available to this environment (global + assigned). */
  agentId?: string | null;
  /** Only pipelines waiting for a workspace admin / approved ones. */
  approvalStatus?: DeploymentWorkflowApprovalStatus | null;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface DeploymentRunsQuery {
  workflowId?: string | null;
  agentId?: string | null;
  status?: DeploymentRunStatus | null;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface DeploymentRunListResponseDto<TRun> {
  items: TRun[];
  total: number;
}

/** `POST workflows` (workspace admins). */
export interface CreateDeploymentWorkflowDto {
  connectionId: string;
  name: string;
  description?: string | null;
  repository: string;
  /** Provider workflow (GitHub workflow file or id); omitted where the provider has none. */
  workflow?: string | null;
  defaultRef?: string | null;
  defaultInputs?: Record<string, string>;
  scope?: DeploymentWorkflowScope;
  agentIds?: string[];
  agentTriggerEnabled?: boolean;
  enabled?: boolean;
}

export type UpdateDeploymentWorkflowDto = Partial<CreateDeploymentWorkflowDto>;

/** `POST workflows/:workflowId/trigger`: optional environment the run is for. */
export interface TriggerDeploymentWorkflowDto extends DeploymentTriggerInput {
  agentId?: string;
}

export interface DeploymentWorkflowSyncResponseDto {
  synced: number;
}

/** Logs shown in the console logs viewer (whole run, or one job). */
export interface DeploymentLogsTarget {
  runId: string;
  jobId: string | null;
}
