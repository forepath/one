import type {
  Client,
  PermissionOption,
  ReadTextFileRequest,
  ReadTextFileResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
  WriteTextFileRequest,
  WriteTextFileResponse,
} from '@agentclientprotocol/sdk';
import { Injectable, Logger } from '@nestjs/common';

import { AgentFileSystemService } from '../../services/agent-file-system.service';
import type { AgentResponseObject } from '../agent-provider.interface';

import { AcpNotificationMapper, createAcpToolCallState, type AcpToolCallState } from './acp-notification-mapper';

export interface AcpClientHostContext {
  agentId: string;
  containerId: string;
}

export interface AcpPromptEventSink {
  onResponses(objects: AgentResponseObject[]): void;
}

/**
 * Mutable callbacks/state for a long-lived ACP client connection.
 * Updated at the start of each prompt so session reuse keeps streaming to the active turn.
 */
export interface AcpClientHostBindings {
  sink: AcpPromptEventSink;
  toolCallState: AcpToolCallState;
}

@Injectable()
export class AcpClientHostFactory {
  private readonly logger = new Logger(AcpClientHostFactory.name);

  constructor(
    private readonly agentFileSystemService: AgentFileSystemService,
    private readonly mapper: AcpNotificationMapper,
  ) {}

  create(context: AcpClientHostContext, bindings: AcpClientHostBindings): Client {
    const autoApprove = process.env.ACP_AUTO_APPROVE !== 'false';

    return {
      sessionUpdate: async (params: SessionNotification): Promise<void> => {
        const mapped = this.mapper.mapSessionUpdate(params, bindings.toolCallState);

        if (mapped.length > 0) {
          bindings.sink.onResponses(mapped);
        }
      },
      requestPermission: async (params: RequestPermissionRequest): Promise<RequestPermissionResponse> => {
        if (params.options.length === 0) {
          const errorMessage = `ACP session permission denied for agent ${context.agentId}: no permission options available`;

          this.logger.warn(errorMessage);
          throw new Error(errorMessage);
        }

        if (!autoApprove) {
          this.logger.warn(`ACP permission request cancelled for agent ${context.agentId}: auto-approve is disabled`);

          return {
            outcome: {
              outcome: 'cancelled',
            },
          };
        }

        const optionId = selectAutoApprovePermissionOptionId(params.options);

        return {
          outcome: {
            outcome: 'selected',
            optionId,
          },
        };
      },
      readTextFile: async (params: ReadTextFileRequest): Promise<ReadTextFileResponse> => {
        const result = await this.agentFileSystemService.readFile(context.agentId, params.path, 'app');
        const text = result.fileType === 'text' ? result.buffer.toString('utf-8') : result.buffer.toString('base64');

        return { content: text };
      },
      writeTextFile: async (params: WriteTextFileRequest): Promise<WriteTextFileResponse> => {
        await this.agentFileSystemService.writeFile(
          context.agentId,
          params.path,
          Buffer.from(params.content, 'utf-8'),
          'app',
        );

        return {};
      },
    };
  }
}

export function createAcpClientHostBindings(sink: AcpPromptEventSink): AcpClientHostBindings {
  return {
    sink,
    toolCallState: createAcpToolCallState(),
  };
}

/** Prefer allow_once / allow_always over reject_* when auto-approving. */
export function selectAutoApprovePermissionOptionId(options: PermissionOption[]): string {
  const allowAlways = options.find((option) => option.kind === 'allow_always');

  if (allowAlways) {
    return allowAlways.optionId;
  }

  const allowOnce = options.find((option) => option.kind === 'allow_once');

  if (allowOnce) {
    return allowOnce.optionId;
  }

  return options[0].optionId;
}
