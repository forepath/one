import type {
  AgentDeploymentControllerRequest,
  AgentDeploymentControllerResponse,
  AgentDeploymentRunListResponse,
  AgentDeploymentSyncResponse,
  AgentDeploymentWorkflowInput,
  AgentDeploymentWorkflowListResponse,
  AgentDeploymentWorkflowUpdateInput,
  DeploymentConnectionOption,
  DeploymentRunDetail,
  DeploymentRunLogs,
  DeploymentRunSummary,
  DeploymentWorkflowSummary,
} from '@forepath/agenstra/shared/util-opencode-config';
import { HttpException, HttpStatus, Injectable, ServiceUnavailableException } from '@nestjs/common';

/**
 * Runtime hook provided by the agents gateway (registered on module init) so this service does not
 * depend on the gateway directly.
 */
export interface AgentDeploymentsGatewayBridge {
  /** Ask a connected controller socket of this agent to read / change the deployments available to the agent. */
  requestControllerDeployments(
    agentId: string,
    request: AgentDeploymentControllerRequest,
  ): Promise<AgentDeploymentControllerResponse>;
}

type OkResponse = Extract<AgentDeploymentControllerResponse, { ok: true }>;

/** Manager response of `GET /agent-context/deployments/connections`. */
export interface AgentDeploymentConnectionListResponse {
  connections: DeploymentConnectionOption[];
}

/**
 * Agent-facing deployments API (called by the worker MCP server, `agenstra_deployments_*` tools). Workflows and runs
 * live in the agent-controller; this service only forwards requests of the authenticated agent over the controller
 * socket. The controller scopes them to the workspace of that socket and to the workflows available to the agent
 * (global or assigned), only lets it trigger / cancel where the workflow and the action source allow it, and only
 * lets it change workflows assigned exclusively to itself (pending until a workspace admin approves them).
 *
 * Run actions (trigger / cancel) are decided per session by the deployment actions service, which calls
 * {@link requestController} directly.
 */
@Injectable()
export class AgentDeploymentsApiService {
  private bridge?: AgentDeploymentsGatewayBridge;

  registerBridge(bridge: AgentDeploymentsGatewayBridge): void {
    this.bridge = bridge;
  }

  async listWorkflows(agentId: string): Promise<AgentDeploymentWorkflowListResponse> {
    const response = await this.call({ op: 'listWorkflows', agentId });

    return { workflows: response.workflows ?? [] };
  }

  async listRuns(
    agentId: string,
    query: { workflowId?: string; limit?: number } = {},
  ): Promise<AgentDeploymentRunListResponse> {
    const response = await this.call({
      op: 'listRuns',
      agentId,
      ...(query.workflowId ? { workflowId: query.workflowId } : {}),
      ...(query.limit !== undefined ? { limit: query.limit } : {}),
    });

    return { runs: response.runs ?? [] };
  }

  async getRun(agentId: string, runId: string): Promise<DeploymentRunDetail> {
    const response = await this.call({ op: 'getRun', agentId, runId });

    return { run: this.requireRun(response), jobs: response.jobs ?? [] };
  }

  async getRunLogs(agentId: string, runId: string, jobId?: string): Promise<DeploymentRunLogs> {
    const response = await this.call({ op: 'getRunLogs', agentId, runId, ...(jobId ? { jobId } : {}) });

    if (!response.logs || typeof response.logs.logs !== 'string') {
      throw this.malformed();
    }

    return { logs: response.logs.logs, truncated: response.logs.truncated === true };
  }

  /** Workflow available to the agent (approval prompt of run actions). */
  async getWorkflow(agentId: string, workflowId: string): Promise<DeploymentWorkflowSummary> {
    return this.requireWorkflow(await this.call({ op: 'getWorkflow', agentId, workflowId }));
  }

  async syncWorkflow(agentId: string, workflowId: string): Promise<AgentDeploymentSyncResponse> {
    const response = await this.call({ op: 'syncWorkflow', agentId, workflowId });

    if (typeof response.synced !== 'number') {
      throw this.malformed();
    }

    return { synced: response.synced };
  }

  async describeWorkflow(agentId: string, workflowId: string): Promise<DeploymentWorkflowSummary> {
    return this.requireWorkflow(await this.call({ op: 'describeWorkflow', agentId, workflowId }));
  }

  async listConnections(agentId: string): Promise<AgentDeploymentConnectionListResponse> {
    const response = await this.call({ op: 'listConnections', agentId });

    return { connections: response.connections ?? [] };
  }

  async createWorkflow(agentId: string, input: AgentDeploymentWorkflowInput): Promise<DeploymentWorkflowSummary> {
    return this.requireWorkflow(await this.call({ op: 'createWorkflow', agentId, input }));
  }

  async updateWorkflow(
    agentId: string,
    workflowId: string,
    input: AgentDeploymentWorkflowUpdateInput,
  ): Promise<DeploymentWorkflowSummary> {
    return this.requireWorkflow(await this.call({ op: 'updateWorkflow', agentId, workflowId, input }));
  }

  async deleteWorkflow(agentId: string, workflowId: string): Promise<void> {
    const response = await this.call({ op: 'deleteWorkflow', agentId, workflowId });

    if (response.deleted !== true) {
      throw this.malformed();
    }
  }

  /**
   * Raw controller request: never throws, unavailable controllers answer `{ ok: false, status: 503 }` (the deployment
   * actions service maps every outcome to a decision for the agent).
   */
  async requestController(request: AgentDeploymentControllerRequest): Promise<AgentDeploymentControllerResponse> {
    if (!this.bridge) {
      return { ok: false, error: 'Deployments are unavailable', status: 503 };
    }

    try {
      return await this.bridge.requestControllerDeployments(request.agentId, request);
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Deployment request failed',
        status: 502,
      };
    }
  }

  private requireRun(response: OkResponse): DeploymentRunSummary {
    if (!response.run) {
      throw this.malformed();
    }

    return response.run;
  }

  private requireWorkflow(response: OkResponse): DeploymentWorkflowSummary {
    if (!response.workflow) {
      throw this.malformed();
    }

    return response.workflow;
  }

  private malformed(): HttpException {
    return new HttpException('Malformed deployment response from the controller', HttpStatus.BAD_GATEWAY);
  }

  private async call(request: AgentDeploymentControllerRequest): Promise<OkResponse> {
    if (!this.bridge) {
      throw new ServiceUnavailableException('Deployments are unavailable');
    }

    const response = await this.bridge.requestControllerDeployments(request.agentId, request);

    if (response.ok === false) {
      const status = response.status && response.status >= 400 && response.status < 600 ? response.status : 502;

      throw new HttpException(response.error || 'Deployment request failed', status);
    }

    return response;
  }
}
