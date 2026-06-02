import { Injectable } from '@nestjs/common';

import type { AgentProviderOptions } from '../agent-provider.interface';
import type { AgentResponseObject } from '../agent-provider.interface';

import type { AcpLaunchSpec, AcpSessionKey } from './acp-launch-spec.types';
import { AcpSessionService } from './acp-session.service';

@Injectable()
export class AcpAgentMessagingService {
  constructor(private readonly acpSessionService: AcpSessionService) {}

  async sendMessage(
    key: AcpSessionKey,
    launchSpec: AcpLaunchSpec,
    message: string,
    options?: AgentProviderOptions,
  ): Promise<string> {
    return this.acpSessionService.prompt(key, launchSpec, message, options);
  }

  async *sendMessageStream(
    key: AcpSessionKey,
    launchSpec: AcpLaunchSpec,
    message: string,
    options?: AgentProviderOptions,
  ): AsyncIterable<string> {
    for await (const obj of this.acpSessionService.promptStream(key, launchSpec, message, options)) {
      yield JSON.stringify(obj);
    }
  }

  async sendInitialization(
    key: AcpSessionKey,
    launchSpec: AcpLaunchSpec,
    instructions: string,
    options?: AgentProviderOptions,
  ): Promise<void> {
    await this.acpSessionService.prompt(key, launchSpec, instructions, options);
  }

  async *streamChatEvents(
    key: AcpSessionKey,
    launchSpec: AcpLaunchSpec,
    message: string,
    options?: AgentProviderOptions,
  ): AsyncIterable<AgentResponseObject> {
    yield* this.acpSessionService.promptStream(key, launchSpec, message, options);
  }
}
