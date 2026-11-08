import {
  AGENSTRA_CONTEXT_API_HEADERS,
  AGENSTRA_CONTEXT_API_ROUTE,
  AGENSTRA_CONTEXT_MCP_ENV,
  AGENSTRA_CONTENT_CHANGES_API_SEGMENT,
  AGENSTRA_DEPLOYMENTS_API_SEGMENT,
  AGENSTRA_GRAPH_API_SEGMENT,
  AGENSTRA_HANDOFFS_API_SEGMENT,
  AGENSTRA_TASKS_API_SEGMENT,
  type AgentContextAccessResponse,
  type AgentContextGetResponse,
  type AgentContextListResponse,
  type AgentContextMountsResponse,
  type AgentContextSearchResponse,
  type AgentContentChangeRequest,
  type AgentContentChangeResponse,
  type AgentDeploymentActionResponse,
  type AgentDeploymentRunListResponse,
  type AgentDeploymentSyncResponse,
  type AgentDeploymentWorkflowInput,
  type AgentDeploymentWorkflowListResponse,
  type AgentDeploymentWorkflowUpdateInput,
  type DeploymentConnectionOption,
  type DeploymentRunDetail,
  type DeploymentRunLogs,
  type DeploymentTriggerInput,
  type DeploymentWorkflowSummary,
  type AgentHandoffAgentSummary,
  type AgentHandoffAgentsResponse,
  type AgentHandoffProfileInput,
  type AgentHandoffSelfSummary,
  type AgentHandoffCreateInput,
  type AgentHandoffRespondInput,
  type AgentHandoffResponse,
  type AgentTaskCreateInput,
  type AgentTaskDetailResponse,
  type AgentTaskListResponse,
  type AgentTaskRunNowResponse,
  type AgentTaskSummary,
  type AgentTaskUpdateInput,
} from '@forepath/agenstra/shared/util-opencode-config';

export interface ContextApiConfig {
  apiUrl: string;
  agentId: string;
  agentToken: string;
}

/** Plain requests stay short; access requests and content changes long-poll on the manager (user decision). */
const DEFAULT_TIMEOUT_MS = 30_000;
const ACCESS_REQUEST_TIMEOUT_MS = 150_000;
/** Missing peer profiles are generated on request (the manager answers within 150 s). */
const PROFILE_REQUEST_TIMEOUT_MS = 170_000;
/** The first graph query of an environment builds its graph (streams the workspace), which can take a while. */
const GRAPH_REQUEST_TIMEOUT_MS = 170_000;
/** Deployment calls reach the CI/CD provider (dispatch, run lookup, log download) through the controller. */
const DEPLOYMENT_REQUEST_TIMEOUT_MS = 90_000;
/**
 * Trigger / cancel long-poll on the manager while the user decides in a visible chat (up to 120 s), then reach the
 * CI/CD provider through the controller (up to 60 s).
 */
const DEPLOYMENT_ACTION_TIMEOUT_MS = 200_000;

/** Query parameters of graph requests (undefined / empty values are omitted). */
export type GraphQuery = Record<string, string | number | undefined>;

export class ContextApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ContextApiError';
  }
}

export function readContextApiConfig(env: NodeJS.ProcessEnv = process.env): ContextApiConfig {
  const apiUrl = env[AGENSTRA_CONTEXT_MCP_ENV.apiUrl]?.trim();
  const agentId = env[AGENSTRA_CONTEXT_MCP_ENV.agentId]?.trim();
  const agentToken = env[AGENSTRA_CONTEXT_MCP_ENV.agentToken]?.trim();
  const missing = [
    !apiUrl && AGENSTRA_CONTEXT_MCP_ENV.apiUrl,
    !agentId && AGENSTRA_CONTEXT_MCP_ENV.agentId,
    !agentToken && AGENSTRA_CONTEXT_MCP_ENV.agentToken,
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new ContextApiError(`Missing environment: ${missing.join(', ')}`);
  }

  return {
    apiUrl: (apiUrl as string).replace(/\/+$/, ''),
    agentId: agentId as string,
    agentToken: agentToken as string,
  };
}

type FetchFn = typeof fetch;

/**
 * HTTP client for the agent-manager context API (`/agent-context`, incl. the agent's own tasks, handoffs and the
 * deployments available to its environment).
 */
export class ContextApiClient {
  constructor(
    private readonly config: ContextApiConfig,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  health(): Promise<void> {
    return this.request<void>('GET', 'health');
  }

  list(ticket: string): Promise<AgentContextListResponse> {
    return this.request('GET', `tickets/${encodeURIComponent(ticket)}`);
  }

  mounts(ticket: string, resolve?: string): Promise<AgentContextMountsResponse> {
    const query = resolve ? `?${new URLSearchParams({ resolve }).toString()}` : '';

    return this.request('GET', `tickets/${encodeURIComponent(ticket)}/mounts${query}`);
  }

  search(
    ticket: string,
    options: { query?: string; kinds?: string[]; limit?: number },
  ): Promise<AgentContextSearchResponse> {
    const params = new URLSearchParams();

    if (options.query) params.set('query', options.query);
    if (options.kinds?.length) params.set('kinds', options.kinds.join(','));
    if (options.limit !== undefined) params.set('limit', String(options.limit));

    const query = params.toString();

    return this.request('GET', `tickets/${encodeURIComponent(ticket)}/search${query ? `?${query}` : ''}`);
  }

  get(ticket: string, ref: string): Promise<AgentContextGetResponse> {
    return this.request('GET', `tickets/${encodeURIComponent(ticket)}/items/${encodeURIComponent(ref)}`);
  }

  requestAccess(ticket: string, refs: string[], reason?: string): Promise<AgentContextAccessResponse> {
    return this.request(
      'POST',
      `tickets/${encodeURIComponent(ticket)}/access-requests`,
      { refs, ...(reason ? { reason } : {}) },
      ACCESS_REQUEST_TIMEOUT_MS,
    );
  }

  accessStatus(ticket: string, requestId: string): Promise<AgentContextAccessResponse> {
    return this.request(
      'GET',
      `tickets/${encodeURIComponent(ticket)}/access-requests/${encodeURIComponent(requestId)}`,
      undefined,
      ACCESS_REQUEST_TIMEOUT_MS,
    );
  }

  requestChange(ticket: string, change: AgentContentChangeRequest): Promise<AgentContentChangeResponse> {
    return this.request(
      'POST',
      `tickets/${encodeURIComponent(ticket)}/${AGENSTRA_CONTENT_CHANGES_API_SEGMENT}`,
      change,
      ACCESS_REQUEST_TIMEOUT_MS,
    );
  }

  changeStatus(ticket: string, requestId: string): Promise<AgentContentChangeResponse> {
    return this.request(
      'GET',
      `tickets/${encodeURIComponent(ticket)}/${AGENSTRA_CONTENT_CHANGES_API_SEGMENT}/${encodeURIComponent(requestId)}`,
      undefined,
      ACCESS_REQUEST_TIMEOUT_MS,
    );
  }

  listTasks(): Promise<AgentTaskListResponse> {
    return this.request('GET', AGENSTRA_TASKS_API_SEGMENT);
  }

  getTask(taskId: string): Promise<AgentTaskDetailResponse> {
    return this.request('GET', `${AGENSTRA_TASKS_API_SEGMENT}/${encodeURIComponent(taskId)}`);
  }

  createTask(input: AgentTaskCreateInput): Promise<AgentTaskSummary> {
    return this.request('POST', AGENSTRA_TASKS_API_SEGMENT, input);
  }

  updateTask(taskId: string, input: AgentTaskUpdateInput): Promise<AgentTaskSummary> {
    return this.request('PATCH', `${AGENSTRA_TASKS_API_SEGMENT}/${encodeURIComponent(taskId)}`, input);
  }

  deleteTask(taskId: string): Promise<void> {
    return this.request('DELETE', `${AGENSTRA_TASKS_API_SEGMENT}/${encodeURIComponent(taskId)}`);
  }

  runTask(taskId: string): Promise<AgentTaskRunNowResponse> {
    return this.request('POST', `${AGENSTRA_TASKS_API_SEGMENT}/${encodeURIComponent(taskId)}/runs`, {});
  }

  listHandoffAgents(): Promise<AgentHandoffAgentsResponse> {
    return this.request('GET', `${AGENSTRA_HANDOFFS_API_SEGMENT}/agents`);
  }

  getHandoffProfile(targetAgentId: string): Promise<AgentHandoffAgentSummary> {
    return this.request(
      'GET',
      `${AGENSTRA_HANDOFFS_API_SEGMENT}/agents/${encodeURIComponent(targetAgentId)}/profile`,
      undefined,
      PROFILE_REQUEST_TIMEOUT_MS,
    );
  }

  updateHandoffProfile(input: AgentHandoffProfileInput): Promise<AgentHandoffSelfSummary> {
    return this.request('PUT', `${AGENSTRA_HANDOFFS_API_SEGMENT}/profile`, input);
  }

  createHandoff(input: AgentHandoffCreateInput): Promise<AgentHandoffResponse> {
    return this.request('POST', AGENSTRA_HANDOFFS_API_SEGMENT, input);
  }

  getHandoff(handoffId: string): Promise<AgentHandoffResponse> {
    return this.request('GET', `${AGENSTRA_HANDOFFS_API_SEGMENT}/${encodeURIComponent(handoffId)}`);
  }

  respondToHandoff(handoffId: string, input: AgentHandoffRespondInput): Promise<AgentHandoffResponse> {
    return this.request('POST', `${AGENSTRA_HANDOFFS_API_SEGMENT}/${encodeURIComponent(handoffId)}/response`, input);
  }

  listDeploymentWorkflows(): Promise<AgentDeploymentWorkflowListResponse> {
    return this.request(
      'GET',
      `${AGENSTRA_DEPLOYMENTS_API_SEGMENT}/workflows`,
      undefined,
      DEPLOYMENT_REQUEST_TIMEOUT_MS,
    );
  }

  listDeploymentRuns(options: { workflowId?: string; limit?: number } = {}): Promise<AgentDeploymentRunListResponse> {
    const params = new URLSearchParams();

    if (options.workflowId) params.set('workflowId', options.workflowId);
    if (options.limit !== undefined) params.set('limit', String(options.limit));

    const query = params.toString();

    return this.request(
      'GET',
      `${AGENSTRA_DEPLOYMENTS_API_SEGMENT}/runs${query ? `?${query}` : ''}`,
      undefined,
      DEPLOYMENT_REQUEST_TIMEOUT_MS,
    );
  }

  getDeploymentRun(runId: string): Promise<DeploymentRunDetail> {
    return this.request(
      'GET',
      `${AGENSTRA_DEPLOYMENTS_API_SEGMENT}/runs/${encodeURIComponent(runId)}`,
      undefined,
      DEPLOYMENT_REQUEST_TIMEOUT_MS,
    );
  }

  getDeploymentRunLogs(runId: string, jobId?: string): Promise<DeploymentRunLogs> {
    const query = jobId ? `?${new URLSearchParams({ jobId }).toString()}` : '';

    return this.request(
      'GET',
      `${AGENSTRA_DEPLOYMENTS_API_SEGMENT}/runs/${encodeURIComponent(runId)}/logs${query}`,
      undefined,
      DEPLOYMENT_REQUEST_TIMEOUT_MS,
    );
  }

  /** Start a run (decided per session: pending while the user decides, see {@link deploymentActionStatus}). */
  triggerDeployment(
    ticket: string,
    workflowId: string,
    input: DeploymentTriggerInput,
  ): Promise<AgentDeploymentActionResponse> {
    return this.request(
      'POST',
      `${AGENSTRA_DEPLOYMENTS_API_SEGMENT}/workflows/${encodeURIComponent(workflowId)}/trigger`,
      { ticket, ...input },
      DEPLOYMENT_ACTION_TIMEOUT_MS,
    );
  }

  cancelDeploymentRun(ticket: string, runId: string): Promise<AgentDeploymentActionResponse> {
    return this.request(
      'POST',
      `${AGENSTRA_DEPLOYMENTS_API_SEGMENT}/runs/${encodeURIComponent(runId)}/cancel`,
      { ticket },
      DEPLOYMENT_ACTION_TIMEOUT_MS,
    );
  }

  /** Keep waiting on a pending trigger / cancel. */
  deploymentActionStatus(ticket: string, requestId: string): Promise<AgentDeploymentActionResponse> {
    return this.request(
      'GET',
      `${AGENSTRA_DEPLOYMENTS_API_SEGMENT}/actions/${encodeURIComponent(requestId)}?${new URLSearchParams({ ticket }).toString()}`,
      undefined,
      DEPLOYMENT_ACTION_TIMEOUT_MS,
    );
  }

  listDeploymentConnections(): Promise<{ connections: DeploymentConnectionOption[] }> {
    return this.request(
      'GET',
      `${AGENSTRA_DEPLOYMENTS_API_SEGMENT}/connections`,
      undefined,
      DEPLOYMENT_REQUEST_TIMEOUT_MS,
    );
  }

  createDeploymentWorkflow(input: AgentDeploymentWorkflowInput): Promise<DeploymentWorkflowSummary> {
    return this.request('POST', `${AGENSTRA_DEPLOYMENTS_API_SEGMENT}/workflows`, input, DEPLOYMENT_REQUEST_TIMEOUT_MS);
  }

  updateDeploymentWorkflow(
    workflowId: string,
    input: AgentDeploymentWorkflowUpdateInput,
  ): Promise<DeploymentWorkflowSummary> {
    return this.request(
      'PATCH',
      `${AGENSTRA_DEPLOYMENTS_API_SEGMENT}/workflows/${encodeURIComponent(workflowId)}`,
      input,
      DEPLOYMENT_REQUEST_TIMEOUT_MS,
    );
  }

  getDeploymentWorkflow(workflowId: string): Promise<DeploymentWorkflowSummary> {
    return this.request(
      'GET',
      `${AGENSTRA_DEPLOYMENTS_API_SEGMENT}/workflows/${encodeURIComponent(workflowId)}`,
      undefined,
      DEPLOYMENT_REQUEST_TIMEOUT_MS,
    );
  }

  syncDeploymentWorkflow(workflowId: string): Promise<AgentDeploymentSyncResponse> {
    return this.request(
      'POST',
      `${AGENSTRA_DEPLOYMENTS_API_SEGMENT}/workflows/${encodeURIComponent(workflowId)}/sync`,
      undefined,
      DEPLOYMENT_REQUEST_TIMEOUT_MS,
    );
  }

  deleteDeploymentWorkflow(workflowId: string): Promise<void> {
    return this.request(
      'DELETE',
      `${AGENSTRA_DEPLOYMENTS_API_SEGMENT}/workflows/${encodeURIComponent(workflowId)}`,
      undefined,
      DEPLOYMENT_REQUEST_TIMEOUT_MS,
    );
  }

  /** Read-only graph endpoints (`/agent-context/graphs/<path>?<query>`). */
  graph<T>(path: string, query: GraphQuery = {}): Promise<T> {
    const params = new URLSearchParams();

    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') {
        params.set(key, String(value));
      }
    }

    const search = params.toString();

    return this.request(
      'GET',
      `${AGENSTRA_GRAPH_API_SEGMENT}/${path}${search ? `?${search}` : ''}`,
      undefined,
      GRAPH_REQUEST_TIMEOUT_MS,
    );
  }

  refreshGraph<T>(): Promise<T> {
    return this.request('POST', `${AGENSTRA_GRAPH_API_SEGMENT}/refresh`, {});
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<T> {
    let response: Response;

    try {
      response = await this.fetchFn(`${this.config.apiUrl}/${AGENSTRA_CONTEXT_API_ROUTE}/${path}`, {
        method,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${this.config.agentToken}`,
          [AGENSTRA_CONTEXT_API_HEADERS.agentId]: this.config.agentId,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      throw new ContextApiError(`Agenstra context API unreachable: ${message}`);
    }

    if (!response.ok) {
      throw new ContextApiError(await this.errorMessage(response), response.status);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }

  private async errorMessage(response: Response): Promise<string> {
    try {
      const payload = (await response.json()) as { message?: unknown };
      const message = Array.isArray(payload.message) ? payload.message.join('; ') : payload.message;

      if (typeof message === 'string' && message.trim()) {
        return message;
      }
    } catch {
      // fall through
    }

    return `Agenstra context API responded with HTTP ${response.status}`;
  }
}
