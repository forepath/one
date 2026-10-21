import type {
  AgentTaskControllerRequest,
  AgentTaskControllerResponse,
  AgentTaskCreateInput,
  AgentTaskDetailResponse,
  AgentTaskListResponse,
  AgentTaskRunNowResponse,
  AgentTaskSummary,
  AgentTaskUpdateInput,
} from '@forepath/agenstra/shared/util-opencode-config';
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';

/**
 * Runtime hook provided by the agents gateway (registered on module init) so this service does not
 * depend on the gateway directly.
 */
export interface AgentTasksGatewayBridge {
  /** Ask a connected controller socket of this agent to read / write the agent's tasks. */
  requestControllerTasks(agentId: string, request: AgentTaskControllerRequest): Promise<AgentTaskControllerResponse>;
}

/**
 * Agent-facing task API (called by the worker MCP server). Tasks live in the agent-controller; this service
 * only forwards requests of the authenticated agent over the controller socket, so an agent can never address
 * tasks of another agent.
 */
@Injectable()
export class AgentTasksApiService {
  private bridge?: AgentTasksGatewayBridge;
  /** Model of the agent's most recent chat turn: default for tasks the agent creates without a model. */
  private readonly lastChatModelByAgent = new Map<string, string>();

  registerBridge(bridge: AgentTasksGatewayBridge): void {
    this.bridge = bridge;
  }

  rememberChatModel(agentId: string, model: string | undefined): void {
    const trimmed = typeof model === 'string' ? model.trim() : '';

    if (trimmed) {
      this.lastChatModelByAgent.set(agentId, trimmed);
    }
  }

  async list(agentId: string): Promise<AgentTaskListResponse> {
    const response = await this.call({ op: 'list', agentId });

    return { tasks: response.tasks ?? [] };
  }

  async get(agentId: string, taskId: string): Promise<AgentTaskDetailResponse> {
    const response = await this.call({ op: 'get', agentId, taskId });

    return { task: this.requireTask(response), runs: response.runs ?? [] };
  }

  async create(agentId: string, input: AgentTaskCreateInput): Promise<AgentTaskSummary> {
    const model = input.model ?? this.lastChatModelByAgent.get(agentId);

    if (!model) {
      throw new BadRequestException('model is required (OpenCode provider/model)');
    }

    return this.requireTask(await this.call({ op: 'create', agentId, input: { ...input, model } }));
  }

  async update(agentId: string, taskId: string, input: AgentTaskUpdateInput): Promise<AgentTaskSummary> {
    return this.requireTask(await this.call({ op: 'update', agentId, taskId, input }));
  }

  async delete(agentId: string, taskId: string): Promise<void> {
    await this.call({ op: 'delete', agentId, taskId });
  }

  async run(agentId: string, taskId: string): Promise<AgentTaskRunNowResponse> {
    const response = await this.call({ op: 'run', agentId, taskId });

    return {
      taskId,
      queued: response.queued === true,
      ...(response.queued === true ? {} : { message: 'A run of this task is already in progress.' }),
    };
  }

  private requireTask(response: Extract<AgentTaskControllerResponse, { ok: true }>): AgentTaskSummary {
    if (!response.task) {
      throw new HttpException('Malformed task response from the controller', HttpStatus.BAD_GATEWAY);
    }

    return response.task;
  }

  private async call(request: AgentTaskControllerRequest): Promise<Extract<AgentTaskControllerResponse, { ok: true }>> {
    if (!this.bridge) {
      throw new ServiceUnavailableException('Task management is unavailable');
    }

    const response = await this.bridge.requestControllerTasks(request.agentId, request);

    if (response.ok === false) {
      const status = response.status && response.status >= 400 && response.status < 600 ? response.status : 502;

      throw new HttpException(response.error || 'Task request failed', status);
    }

    return response;
  }
}
