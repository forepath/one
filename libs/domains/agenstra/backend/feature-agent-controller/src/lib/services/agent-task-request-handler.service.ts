import {
  AGENT_TASK_REQUEST_EVENT,
  type AgentTaskControllerResponse,
  type AgentTaskCreateInput,
  type AgentTaskUpdateInput,
} from '@forepath/agenstra/shared/util-opencode-config';
import { HttpException, Injectable, Logger } from '@nestjs/common';
import type { Socket as ClientSocket } from 'socket.io-client';

import { AgentTasksService } from './agent-tasks.service';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const STRING_FIELDS = ['title', 'prompt', 'cronExpression', 'timezone', 'model'] as const;

const OPS = new Set(['list', 'get', 'create', 'update', 'delete', 'run']);

/**
 * Answers task requests of an agent (worker `agenstra` MCP server → manager → controller) over the Socket.IO
 * connection the controller holds to that manager. The workspace is the one bound to the connection; the agent id
 * is the one the manager authenticated with the agent's context token. Agents therefore only reach their own tasks.
 */
@Injectable()
export class AgentTaskRequestHandlerService {
  private readonly logger = new Logger(AgentTaskRequestHandlerService.name);

  constructor(private readonly tasks: AgentTasksService) {}

  /** Register the ack handler on a controller → manager socket for one workspace. */
  attach(remote: ClientSocket, clientId: string): void {
    remote.on(AGENT_TASK_REQUEST_EVENT, (request: unknown, ack?: (response: AgentTaskControllerResponse) => void) => {
      if (typeof ack !== 'function') {
        return;
      }

      void this.handle(clientId, request).then(ack);
    });
  }

  async handle(clientId: string, raw: unknown): Promise<AgentTaskControllerResponse> {
    const request = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const agentId = typeof request['agentId'] === 'string' ? request['agentId'].trim().toLowerCase() : '';
    const taskId = typeof request['taskId'] === 'string' ? request['taskId'].trim().toLowerCase() : '';

    if (typeof request['op'] !== 'string' || !OPS.has(request['op'])) {
      return { ok: false, error: 'Unsupported task request', status: 400 };
    }

    if (!UUID_V4.test(agentId)) {
      return { ok: false, error: 'Invalid agent', status: 400 };
    }

    const needsTask = request['op'] !== 'list' && request['op'] !== 'create';

    if (needsTask && !UUID_V4.test(taskId)) {
      return { ok: false, error: 'Task not found', status: 404 };
    }

    try {
      switch (request['op']) {
        case 'list':
          return { ok: true, tasks: await this.tasks.listForAgent(clientId, agentId) };
        case 'get': {
          const detail = await this.tasks.getForAgent(clientId, agentId, taskId);

          return { ok: true, task: detail.task, runs: detail.runs };
        }
        case 'create':
          return {
            ok: true,
            task: await this.tasks.createForAgent(
              clientId,
              agentId,
              this.parseInput(request['input']) as AgentTaskCreateInput,
            ),
          };
        case 'update':
          return {
            ok: true,
            task: await this.tasks.updateForAgent(clientId, agentId, taskId, this.parseInput(request['input'])),
          };
        case 'delete':
          await this.tasks.removeForAgent(clientId, agentId, taskId);

          return { ok: true, deleted: true };
        default:
          return { ok: true, queued: (await this.tasks.runNowForAgent(clientId, agentId, taskId)).queued };
      }
    } catch (error) {
      if (error instanceof HttpException) {
        return { ok: false, error: this.httpErrorMessage(error), status: error.getStatus() };
      }

      const message = error instanceof Error ? error.message : String(error);

      this.logger.warn(`Agent task request failed for client ${clientId}: ${message}`);

      return { ok: false, error: 'Task request failed', status: 500 };
    }
  }

  /** Typed fields only; semantic validation happens in {@link AgentTasksService}. */
  private parseInput(raw: unknown): AgentTaskUpdateInput {
    const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const fields: AgentTaskUpdateInput = {};

    for (const key of STRING_FIELDS) {
      if (typeof input[key] === 'string') {
        fields[key] = input[key] as string;
      }
    }

    if (typeof input['enabled'] === 'boolean') {
      fields.enabled = input['enabled'];
    }

    return fields;
  }

  private httpErrorMessage(error: HttpException): string {
    const response = error.getResponse();
    const message =
      response && typeof response === 'object' ? (response as { message?: unknown }).message : String(response);

    return Array.isArray(message) ? message.join('; ') : typeof message === 'string' ? message : error.message;
  }
}
