import {
  AGENT_HANDOFF_REQUEST_EVENT,
  isAgentHandoffResponseStatus,
  type AgentHandoffControllerResponse,
} from '@forepath/agenstra/shared/util-opencode-config';
import { HttpException, Injectable, Logger } from '@nestjs/common';
import type { Socket as ClientSocket } from 'socket.io-client';

import { AgentHandoffsService, type AgentHandoffSource } from './agent-handoffs.service';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const OPS = new Set(['agents', 'create', 'get', 'respond']);

function str(record: Record<string, unknown>, key: string): string {
  return typeof record[key] === 'string' ? (record[key] as string).trim() : '';
}

/**
 * Answers handoff requests of an agent (worker `agenstra` MCP server → manager → controller) over the Socket.IO
 * connection the controller holds to that manager. The workspace is the one bound to the connection; the agent id
 * is the one the manager authenticated with the agent's context token. Handoffs therefore never leave the workspace.
 */
@Injectable()
export class AgentHandoffRequestHandlerService {
  private readonly logger = new Logger(AgentHandoffRequestHandlerService.name);

  constructor(private readonly handoffs: AgentHandoffsService) {}

  /** Register the ack handler on a controller → manager socket for one workspace. */
  attach(remote: ClientSocket, clientId: string): void {
    remote.on(
      AGENT_HANDOFF_REQUEST_EVENT,
      (request: unknown, ack?: (response: AgentHandoffControllerResponse) => void) => {
        if (typeof ack !== 'function') {
          return;
        }

        void this.handle(clientId, request).then(ack);
      },
    );
  }

  async handle(clientId: string, raw: unknown): Promise<AgentHandoffControllerResponse> {
    const request = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const op = request['op'];
    const agentId = str(request, 'agentId').toLowerCase();
    const handoffId = str(request, 'handoffId').toLowerCase();

    if (typeof op !== 'string' || !OPS.has(op)) {
      return { ok: false, error: 'Unsupported handoff request', status: 400 };
    }

    if (!UUID_V4.test(agentId)) {
      return { ok: false, error: 'Invalid agent', status: 400 };
    }

    if (op !== 'agents' && op !== 'create' && !UUID_V4.test(handoffId)) {
      return { ok: false, error: 'Handoff not found', status: 404 };
    }

    const input = (request['input'] && typeof request['input'] === 'object' ? request['input'] : {}) as Record<
      string,
      unknown
    >;

    try {
      switch (op) {
        case 'agents':
          return { ok: true, agents: await this.handoffs.listAgentsForAgent(clientId, agentId) };
        case 'create': {
          const sourceChatId = str(request, 'sourceChatId').toLowerCase();
          const sourceTaskId = str(request, 'sourceTaskId').toLowerCase();
          // Exactly one source: the visible chat, or the task whose run is the manager-attributed working context.
          const source: AgentHandoffSource | undefined =
            sourceChatId && !sourceTaskId && UUID_V4.test(sourceChatId)
              ? { kind: 'chat', chatId: sourceChatId }
              : sourceTaskId && !sourceChatId && UUID_V4.test(sourceTaskId)
                ? { kind: 'taskRun', taskId: sourceTaskId }
                : undefined;

          if (!source) {
            return { ok: false, error: 'The requesting chat is unknown', status: 400 };
          }

          return {
            ok: true,
            handoff: await this.handoffs.createForAgent(
              clientId,
              agentId,
              source,
              {
                targetAgentId: str(input, 'targetAgentId'),
                title: str(input, 'title'),
                message: str(input, 'message'),
                ...(str(input, 'model') ? { model: str(input, 'model') } : {}),
              },
              str(request, 'sourceModel') || undefined,
            ),
          };
        }
        case 'get':
          return { ok: true, handoff: await this.handoffs.getForAgent(clientId, agentId, handoffId) };
        case 'respond': {
          const status = input['status'];

          if (!isAgentHandoffResponseStatus(status)) {
            return { ok: false, error: 'status must be completed or failed', status: 400 };
          }

          return {
            ok: true,
            handoff: await this.handoffs.respondForAgent(clientId, agentId, handoffId, {
              status,
              response: str(input, 'response'),
            }),
          };
        }
        default:
          return { ok: false, error: 'Unsupported handoff request', status: 400 };
      }
    } catch (error) {
      if (error instanceof HttpException) {
        return { ok: false, error: this.httpErrorMessage(error), status: error.getStatus() };
      }

      const message = error instanceof Error ? error.message : String(error);

      this.logger.warn(`Agent handoff request failed for client ${clientId}: ${message}`);

      return { ok: false, error: 'Handoff request failed', status: 500 };
    }
  }

  private httpErrorMessage(error: HttpException): string {
    const response = error.getResponse();
    const message =
      response && typeof response === 'object' ? (response as { message?: unknown }).message : String(response);

    return Array.isArray(message) ? message.join('; ') : typeof message === 'string' ? message : error.message;
  }
}
