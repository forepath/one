import type {
  Client,
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

import { AcpNotificationMapper } from './acp-notification-mapper';

export interface AcpClientHostContext {
  agentId: string;
  containerId: string;
}

export interface AcpPromptEventSink {
  onResponses(objects: AgentResponseObject[]): void;
}

/**
 * ACP client role: handles agent callbacks (fs, terminal, permissions) and session updates.
 */
@Injectable()
export class AcpClientHostFactory {
  private readonly logger = new Logger(AcpClientHostFactory.name);

  constructor(
    private readonly agentFileSystemService: AgentFileSystemService,
    private readonly mapper: AcpNotificationMapper,
  ) {}

  create(context: AcpClientHostContext, eventSink: AcpPromptEventSink): Client {
    const autoApprove = process.env.ACP_AUTO_APPROVE !== 'false';

    return {
      sessionUpdate: async (params: SessionNotification): Promise<void> => {
        const mapped = this.mapper.mapSessionUpdate(params);

        if (mapped.length > 0) {
          eventSink.onResponses(mapped);
        }
      },

      requestPermission: async (params: RequestPermissionRequest): Promise<RequestPermissionResponse> => {
        if (autoApprove && params.options.length > 0) {
          return {
            outcome: {
              outcome: 'selected',
              optionId: params.options[0].optionId,
            },
          };
        }

        this.logger.debug(`ACP permission requested for agent ${context.agentId}: ${params.toolCall.title}`);

        return {
          outcome: {
            outcome: 'selected',
            optionId: params.options[0]?.optionId ?? 'allow',
          },
        };
      },

      readTextFile: async (params: ReadTextFileRequest): Promise<ReadTextFileResponse> => {
        const dto = await this.agentFileSystemService.readFile(context.agentId, params.path, 'app');
        const text = dto.encoding === 'utf-8' ? Buffer.from(dto.content, 'base64').toString('utf-8') : dto.content;

        return { content: text };
      },

      writeTextFile: async (params: WriteTextFileRequest): Promise<WriteTextFileResponse> => {
        const base64Content = Buffer.from(params.content, 'utf-8').toString('base64');

        await this.agentFileSystemService.writeFile(context.agentId, params.path, base64Content, 'utf-8', 'app');

        return {};
      },
    };
  }
}
