import {
  AGENSTRA_CONTEXT_API_HEADERS,
  AGENSTRA_CONTEXT_API_ROUTE,
  AGENSTRA_CONTEXT_MCP_ENV,
  AGENSTRA_TASKS_API_SEGMENT,
  type AgentContextAccessResponse,
  type AgentContextGetResponse,
  type AgentContextListResponse,
  type AgentContextSearchResponse,
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

/** Plain requests stay short; access requests long-poll on the manager (user decision). */
const DEFAULT_TIMEOUT_MS = 30_000;
const ACCESS_REQUEST_TIMEOUT_MS = 150_000;

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

/** HTTP client for the agent-manager context API (`/agent-context`, incl. the agent's own tasks). */
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

  private async request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
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
