/**
 * Workspace deployments. CI/CD providers (GitHub Actions, GitLab CI, Jenkins) are reached through instance-wide
 * connections managed by admins (`/connections/deployments`). Workspaces define deployment workflows on top of a
 * connection (`/deployments/:clientId`); a workflow is either available to every environment of the workspace
 * (`global`) or assigned to selected environments. Runs are recorded by the agent-controller (history, live status,
 * audit) and can be triggered from the console or, when the workflow allows it, by an assigned environment through the
 * platform `agenstra` MCP server (`agenstra_deployments_*` tools).
 */

/** CI/CD providers a deployment connection can target. */
export const DEPLOYMENT_PROVIDERS = ['github', 'gitlab', 'jenkins'] as const;

export type DeploymentProvider = (typeof DEPLOYMENT_PROVIDERS)[number];

/**
 * Connection authentication variants, shared with Atlassian connections:
 * - `app`: provider app based (GitHub App installation tokens; Atlassian OAuth 2.0 client credentials)
 * - `token`: personal / project access token or API key (fallback, and the only variant where no app auth exists)
 */
export const CONNECTION_AUTH_TYPES = ['app', 'token'] as const;

export type ConnectionAuthType = (typeof CONNECTION_AUTH_TYPES)[number];

/** Auth variants each deployment provider supports; the first entry is the default. */
export const DEPLOYMENT_PROVIDER_AUTH_TYPES: Readonly<Record<DeploymentProvider, readonly ConnectionAuthType[]>> = {
  github: ['app', 'token'],
  gitlab: ['token'],
  jenkins: ['token'],
};

/** Auth variants of Atlassian connections; the first entry is the default. */
export const ATLASSIAN_CONNECTION_AUTH_TYPES: readonly ConnectionAuthType[] = ['app', 'token'];

export function defaultDeploymentProviderAuthType(provider: DeploymentProvider): ConnectionAuthType {
  return DEPLOYMENT_PROVIDER_AUTH_TYPES[provider][0];
}

export function isDeploymentProvider(value: unknown): value is DeploymentProvider {
  return typeof value === 'string' && (DEPLOYMENT_PROVIDERS as readonly string[]).includes(value);
}

export function isConnectionAuthType(value: unknown): value is ConnectionAuthType {
  return typeof value === 'string' && (CONNECTION_AUTH_TYPES as readonly string[]).includes(value);
}

export function deploymentProviderSupportsAuthType(
  provider: DeploymentProvider,
  authType: ConnectionAuthType,
): boolean {
  return DEPLOYMENT_PROVIDER_AUTH_TYPES[provider].includes(authType);
}

/** Result of the last connection test (persisted so the admin console shows whether a connection works). */
export type ConnectionTestStatus = 'ok' | 'failed' | 'untested';

/** Which workspaces may build workflows on a deployment connection. */
export type DeploymentConnectionWorkspaceAccess = 'all' | 'selected';

/** Who can use a workflow inside its workspace: every environment, or the assigned ones. */
export type DeploymentWorkflowScope = 'global' | 'environments';

/** Normalized run status across providers. */
export const DEPLOYMENT_RUN_STATUSES = ['queued', 'in_progress', 'completed'] as const;

export type DeploymentRunStatus = (typeof DEPLOYMENT_RUN_STATUSES)[number];

/** Normalized run conclusion once `completed`. */
export const DEPLOYMENT_RUN_CONCLUSIONS = [
  'success',
  'failure',
  'cancelled',
  'skipped',
  'timed_out',
  'neutral',
] as const;

export type DeploymentRunConclusion = (typeof DEPLOYMENT_RUN_CONCLUSIONS)[number];

/** Who started a run: a console user, an environment (MCP), or the provider itself (synced history). */
export type DeploymentRunTriggerType = 'user' | 'agent' | 'external';

/** Input bounds shared by the console, the manager API and the controller (authoritative validation). */
export const DEPLOYMENT_LIMITS = {
  labelMaxLength: 200,
  nameMaxLength: 200,
  descriptionMaxLength: 2_000,
  baseUrlMaxLength: 512,
  repositoryMaxLength: 512,
  workflowMaxLength: 512,
  refMaxLength: 255,
  tokenMaxLength: 8_192,
  usernameMaxLength: 320,
  appIdMaxLength: 64,
  privateKeyMaxLength: 16_384,
  inputsMax: 25,
  inputKeyMaxLength: 100,
  inputValueMaxLength: 1_000,
  /** Environments a workflow may be assigned to. */
  assignedEnvironmentsMax: 100,
  /** Workspaces a connection may be restricted to. */
  allowedWorkspacesMax: 500,
  /** Bytes of run / job logs returned (tail). */
  logsMaxBytes: 1_000_000,
  /** Bytes of run / job logs returned to an environment through the MCP server (tail). */
  agentLogsMaxBytes: 200_000,
} as const;

export interface DeploymentConnectionSummary {
  id: string;
  label: string;
  provider: DeploymentProvider;
  /** API base URL for self-hosted instances (GitHub Enterprise, GitLab self-managed, Jenkins); null: provider default. */
  baseUrl: string | null;
  authType: ConnectionAuthType;
  /** Non-secret identifiers only (`appId`, `installationId`, `username`); secrets are never returned. */
  appId: string | null;
  installationId: string | null;
  username: string | null;
  workspaceAccess: DeploymentConnectionWorkspaceAccess;
  allowedClientIds: string[];
  lastTestStatus: ConnectionTestStatus;
  lastTestMessage: string | null;
  lastTestedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** What a workspace admin sees of a connection when picking one for a workflow. */
export interface DeploymentConnectionOption {
  id: string;
  label: string;
  provider: DeploymentProvider;
  lastTestStatus: ConnectionTestStatus;
}

export interface ConnectionTestResult {
  ok: boolean;
  message?: string;
  testedAt: string;
}

export interface DeploymentRepositorySummary {
  /** Provider id used in workflow definitions (`owner/repo`, GitLab project id, Jenkins job full name). */
  id: string;
  name: string;
  fullName: string;
  defaultBranch: string | null;
  url: string | null;
  private: boolean;
}

export interface DeploymentBranchSummary {
  name: string;
  sha: string | null;
  default: boolean;
}

export interface DeploymentProviderWorkflowSummary {
  id: string;
  name: string;
  path: string | null;
  state: string | null;
}

export type DeploymentWorkflowApprovalStatus = 'approved' | 'pending';

export type DeploymentWorkflowActorType = 'user' | 'agent';

export interface DeploymentWorkflowSummary {
  id: string;
  clientId: string;
  connectionId: string;
  provider: DeploymentProvider;
  connectionLabel: string;
  name: string;
  description: string | null;
  /** Provider repository (`owner/repo`, GitLab project id or path, Jenkins job full name). */
  repository: string;
  /** Provider workflow (GitHub workflow file or id); null where the provider has none (GitLab, Jenkins). */
  workflow: string | null;
  defaultRef: string | null;
  /** Default inputs / variables / parameters (overridable per run). */
  defaultInputs: Record<string, string>;
  scope: DeploymentWorkflowScope;
  /** Environments the workflow is assigned to (`scope: environments`). */
  agentIds: string[];
  /** Whether assigned environments may trigger and cancel runs (MCP); otherwise they only read. */
  agentTriggerEnabled: boolean;
  enabled: boolean;
  /**
   * `approved`: runs can be started. `pending`: proposed or changed by an environment (MCP), waiting for a workspace
   * admin; nobody can start runs and only the proposing environment sees it.
   */
  approvalStatus: DeploymentWorkflowApprovalStatus;
  approvedAt: string | null;
  /** Who created / last changed the workflow: a console user or an environment (MCP). */
  createdBy: DeploymentWorkflowActorType;
  updatedBy: DeploymentWorkflowActorType;
  /** Environment that created the workflow (`createdBy: agent`). */
  createdByAgentId: string | null;
  lastRunStatus: DeploymentRunStatus | null;
  lastRunConclusion: DeploymentRunConclusion | null;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DeploymentRunSummary {
  id: string;
  clientId: string;
  workflowId: string;
  workflowName: string;
  /** Environment the run was triggered for / by (null: workspace level). */
  agentId: string | null;
  providerRunId: string | null;
  name: string | null;
  status: DeploymentRunStatus;
  conclusion: DeploymentRunConclusion | null;
  ref: string | null;
  sha: string | null;
  url: string | null;
  inputs: Record<string, string>;
  triggeredBy: DeploymentRunTriggerType;
  triggeredByUserId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DeploymentRunJobSummary {
  id: string;
  name: string;
  status: DeploymentRunStatus;
  conclusion: DeploymentRunConclusion | null;
  startedAt: string | null;
  completedAt: string | null;
  url: string | null;
}

export interface DeploymentRunDetail {
  run: DeploymentRunSummary;
  jobs: DeploymentRunJobSummary[];
}

export interface DeploymentRunLogs {
  logs: string;
  /** True when only the tail was returned. */
  truncated: boolean;
}

export interface DeploymentTriggerInput {
  /** Branch / tag; defaults to the workflow default ref (or the repository default branch). */
  ref?: string;
  /** Overrides of the workflow default inputs. */
  inputs?: Record<string, string>;
}

/** Live events on the `clients` Socket.IO namespace (room `client:{clientId}`). */
export const DEPLOYMENT_SOCKET_EVENTS = {
  workflowUpsert: 'deploymentWorkflowUpsert',
  workflowRemoved: 'deploymentWorkflowRemoved',
  runUpsert: 'deploymentRunUpsert',
} as const;

export interface DeploymentWorkflowRemovedPayload {
  clientId: string;
  workflowId: string;
}

/** OpenCode names MCP tools `<server>_<tool>`, so the agent sees `agenstra_deployments_*`. */
export const AGENSTRA_DEPLOYMENTS_MCP_TOOL_NAMES = {
  listWorkflows: 'deployments_list_workflows',
  getWorkflow: 'deployments_get_workflow',
  /** Import the provider's latest runs of a pipeline into the history (external runs, status refresh). */
  syncWorkflow: 'deployments_sync',
  listRuns: 'deployments_list_runs',
  getRun: 'deployments_get_run',
  getRunLogs: 'deployments_get_run_logs',
  trigger: 'deployments_trigger',
  cancelRun: 'deployments_cancel_run',
  /** Status of a trigger / cancel waiting for the user's decision in a visible chat. */
  actionStatus: 'deployments_action_status',
  listConnections: 'deployments_list_connections',
  createWorkflow: 'deployments_create_workflow',
  updateWorkflow: 'deployments_update_workflow',
  deleteWorkflow: 'deployments_delete_workflow',
} as const;

/**
 * Run actions an environment can request (`deployments_trigger` / `deployments_cancel_run`); also the values of the
 * `allowedDeploymentOperations` opt-ins of tasks and ticket automation. Decided like content changes:
 * - visible chats: the user approves each action (permission-style prompt; "allow for this chat" covers further
 *   actions of the same operation on the same workflow);
 * - unattended runs (scheduled tasks, ticket automation): only the operations a workspace user explicitly allowed for
 *   that task / automation (approved content); the controller checks them again;
 * - plans and other hidden helper sessions: never.
 * The workflow rules apply on top in every case: enabled + approved, available to the environment,
 * `agentTriggerEnabled`, default ref only, defined inputs only.
 */
export const AGENT_DEPLOYMENT_OPERATIONS = ['deployment.trigger', 'deployment.cancel'] as const;

export type AgentDeploymentOperation = (typeof AGENT_DEPLOYMENT_OPERATIONS)[number];

export function isAgentDeploymentOperation(value: unknown): value is AgentDeploymentOperation {
  return typeof value === 'string' && (AGENT_DEPLOYMENT_OPERATIONS as readonly string[]).includes(value);
}

/** Deduplicated, known operations in canonical order (invalid entries are dropped). */
export function normalizeAgentDeploymentOperations(values: readonly unknown[] | undefined): AgentDeploymentOperation[] {
  const requested = new Set((values ?? []).filter(isAgentDeploymentOperation));

  return AGENT_DEPLOYMENT_OPERATIONS.filter((operation) => requested.has(operation));
}

/**
 * Who asks the controller to run a deployment action (determined by the manager from the context ticket of the
 * prompt, never agent input). `chat`: a user approved it in the visible chat. The controller checks task / automation
 * opt-ins against its own records.
 */
export type AgentDeploymentActionSource = { kind: 'chat' } | { kind: 'task'; taskId: string } | { kind: 'automation' };

/**
 * - `applied`: the action was carried out (`run` describes the run afterwards)
 * - `pending`: waiting for the user; call `deployments_action_status` with `requestId`
 * - `denied`: rejected by the user or not allowed in this session
 * - `failed`: approved but the controller refused it (e.g. the workflow does not allow environment triggers)
 */
export type AgentDeploymentActionDecision = 'applied' | 'pending' | 'denied' | 'failed';

export interface AgentDeploymentActionResponse {
  requestId: string;
  decision: AgentDeploymentActionDecision;
  operation: AgentDeploymentOperation;
  run?: DeploymentRunSummary;
  message?: string;
}

/**
 * Workflow an environment proposes for itself (`deployments_create_workflow`): always assigned to that environment
 * only, and pending until a workspace admin approves it. Same bounds as the console editor.
 */
export interface AgentDeploymentWorkflowInput {
  connectionId: string;
  name: string;
  description?: string | null;
  repository: string;
  workflow?: string | null;
  defaultRef?: string | null;
  defaultInputs?: Record<string, string>;
  /** Requested permission to trigger / cancel runs itself; only effective once approved. Defaults to false. */
  agentTriggerEnabled?: boolean;
  /** Defaults to true. */
  enabled?: boolean;
}

export type AgentDeploymentWorkflowUpdateInput = Partial<AgentDeploymentWorkflowInput>;

/** OpenCode permission key covering every deployment tool (wildcard on the tool id). */
export const AGENSTRA_DEPLOYMENTS_MCP_TOOL_PERMISSION = 'agenstra_deployments_*';

/** Manager route segment below the agent context API route (`/api/agent-context/deployments`). */
export const AGENSTRA_DEPLOYMENTS_API_SEGMENT = 'deployments';

/** Socket.IO event (manager → controller, with ack) that reads / triggers the deployments of one agent. */
export const AGENT_DEPLOYMENT_REQUEST_EVENT = 'agentDeploymentRequest';

/**
 * Manager → controller request (Socket.IO ack). `agentId` is the authenticated agent of the MCP call; the controller
 * only exposes enabled workflows that are global or assigned to it, and only lets it trigger / cancel when the
 * workflow has `agentTriggerEnabled`.
 */
export type AgentDeploymentControllerRequest =
  | { op: 'listWorkflows'; agentId: string }
  | { op: 'getWorkflow'; agentId: string; workflowId: string }
  | { op: 'syncWorkflow'; agentId: string; workflowId: string }
  | { op: 'listRuns'; agentId: string; workflowId?: string; limit?: number }
  | { op: 'getRun'; agentId: string; runId: string }
  | { op: 'getRunLogs'; agentId: string; runId: string; jobId?: string }
  | {
      op: 'trigger';
      agentId: string;
      workflowId: string;
      input: DeploymentTriggerInput;
      source: AgentDeploymentActionSource;
    }
  | { op: 'cancelRun'; agentId: string; runId: string; source: AgentDeploymentActionSource }
  /** Workflow lookup for the chat approval prompt (name / repository / ref of a workflow available to the agent). */
  | { op: 'describeWorkflow'; agentId: string; workflowId: string }
  | { op: 'listConnections'; agentId: string }
  | { op: 'createWorkflow'; agentId: string; input: AgentDeploymentWorkflowInput }
  | { op: 'updateWorkflow'; agentId: string; workflowId: string; input: AgentDeploymentWorkflowUpdateInput }
  | { op: 'deleteWorkflow'; agentId: string; workflowId: string };

export const AGENT_DEPLOYMENT_CONTROLLER_OPS = [
  'listWorkflows',
  'getWorkflow',
  'syncWorkflow',
  'listRuns',
  'getRun',
  'getRunLogs',
  'trigger',
  'cancelRun',
  'describeWorkflow',
  'listConnections',
  'createWorkflow',
  'updateWorkflow',
  'deleteWorkflow',
] as const satisfies readonly AgentDeploymentControllerRequest['op'][];

export type AgentDeploymentControllerResponse =
  | {
      ok: true;
      workflows?: DeploymentWorkflowSummary[];
      runs?: DeploymentRunSummary[];
      run?: DeploymentRunSummary;
      jobs?: DeploymentRunJobSummary[];
      logs?: DeploymentRunLogs;
      cancelled?: boolean;
      workflow?: DeploymentWorkflowSummary;
      connections?: DeploymentConnectionOption[];
      deleted?: boolean;
      /** `syncWorkflow`: runs imported or updated from the provider. */
      synced?: number;
    }
  /** `status` mirrors the HTTP status the controller would have answered with (400, 403, 404, ...). */
  | { ok: false; error: string; status?: number };

/** Runs returned to an environment by `deployments_list_runs` (newest first): default and upper bound. */
export const AGENT_DEPLOYMENT_RUNS_DEFAULT_LIMIT = 25;
export const AGENT_DEPLOYMENT_RUNS_MAX_LIMIT = 100;

/** Manager response of `GET /agent-context/deployments/workflows`. */
export interface AgentDeploymentWorkflowListResponse {
  workflows: DeploymentWorkflowSummary[];
}

/** Manager response of `GET /agent-context/deployments/runs`. */
export interface AgentDeploymentRunListResponse {
  runs: DeploymentRunSummary[];
}

/** Terminal check used by pollers and the console (live updates stop once a run completed). */
export function isDeploymentRunActive(status: DeploymentRunStatus): boolean {
  return status !== 'completed';
}

/** Manager response of `POST /agent-context/deployments/workflows/:workflowId/sync`. */
export interface AgentDeploymentSyncResponse {
  synced: number;
}
