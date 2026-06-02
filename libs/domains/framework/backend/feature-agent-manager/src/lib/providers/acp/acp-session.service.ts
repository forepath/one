import { ClientSideConnection, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';
import { Injectable, Logger } from '@nestjs/common';

import type { AgentProviderOptions } from '../agent-provider.interface';
import type { AgentResponseObject } from '../agent-provider.interface';

import { AcpClientHostFactory } from './acp-client-host';
import type { AcpLaunchSpec, AcpSessionKey } from './acp-launch-spec.types';
import { AcpNotificationMapper } from './acp-notification-mapper';
import { buildResumeSessionId } from './acp-provider.config';
import type { AcpTransport } from './acp-transport.interface';
import { DockerAcpTransportFactory } from './docker-acp-transport';

interface ManagedAcpSession {
  connection: ClientSideConnection;
  transport: AcpTransport;
  acpSessionId: string;
  resumeId: string;
}

@Injectable()
export class AcpSessionService {
  private readonly logger = new Logger(AcpSessionService.name);
  private readonly sessions = new Map<string, ManagedAcpSession>();

  constructor(
    private readonly transportFactory: DockerAcpTransportFactory,
    private readonly clientHostFactory: AcpClientHostFactory,
    private readonly mapper: AcpNotificationMapper,
  ) {}

  private sessionMapKey(key: AcpSessionKey): string {
    return `${key.agentId}:${key.containerId}:${key.resumeSessionSuffix ?? ''}`;
  }

  async closeSession(key: AcpSessionKey): Promise<void> {
    const mapKey = this.sessionMapKey(key);
    const existing = this.sessions.get(mapKey);

    if (existing) {
      await existing.transport.close();
      this.sessions.delete(mapKey);
    }
  }

  async closeSessionsForAgent(agentId: string): Promise<void> {
    const prefix = `${agentId}:`;

    for (const [mapKey, session] of this.sessions.entries()) {
      if (mapKey.startsWith(prefix)) {
        await session.transport.close();
        this.sessions.delete(mapKey);
      }
    }
  }

  async *promptStream(
    key: AcpSessionKey,
    launchSpec: AcpLaunchSpec,
    message: string,
    options?: AgentProviderOptions,
  ): AsyncIterable<AgentResponseObject> {
    const collected: AgentResponseObject[] = [];
    const sink = {
      onResponses: (objects: AgentResponseObject[]) => {
        collected.push(...objects);
      },
    };
    const { finalText, acpSessionId } = await this.runPrompt(key, launchSpec, message, options, sink);

    for (const item of collected) {
      yield item;
    }

    if (finalText.trim()) {
      yield this.mapper.buildFinalResult(finalText, acpSessionId);
    }
  }

  async prompt(
    key: AcpSessionKey,
    launchSpec: AcpLaunchSpec,
    message: string,
    options?: AgentProviderOptions,
  ): Promise<string> {
    const parts: string[] = [];

    for await (const obj of this.promptStream(key, launchSpec, message, options)) {
      parts.push(JSON.stringify(obj));
    }

    return parts.join('\n');
  }

  private async runPrompt(
    key: AcpSessionKey,
    launchSpec: AcpLaunchSpec,
    message: string,
    options: AgentProviderOptions | undefined,
    sink: { onResponses: (objects: AgentResponseObject[]) => void },
  ): Promise<{ finalText: string; acpSessionId: string }> {
    let aggregatedText = '';
    const wrappedSink = {
      onResponses: (objects: AgentResponseObject[]) => {
        for (const obj of objects) {
          if (obj.type === 'delta' && typeof obj.delta === 'string') {
            aggregatedText += obj.delta;
          } else if (obj.type === 'result' && typeof obj.result === 'string') {
            aggregatedText = obj.result;
          }
        }

        sink.onResponses(objects);
      },
    };
    const managed = await this.getOrCreateSession(key, launchSpec, wrappedSink);

    await managed.connection.prompt({
      sessionId: managed.acpSessionId,
      prompt: [{ type: 'text', text: message }],
    });

    return { finalText: aggregatedText, acpSessionId: managed.acpSessionId };
  }

  private async getOrCreateSession(
    key: AcpSessionKey,
    launchSpec: AcpLaunchSpec,
    sink: { onResponses: (objects: AgentResponseObject[]) => void },
  ): Promise<ManagedAcpSession> {
    const mapKey = this.sessionMapKey(key);
    const existing = this.sessions.get(mapKey);

    if (existing) {
      return existing;
    }

    const resumeId = buildResumeSessionId(key.agentId, key.containerId, key.resumeSessionSuffix);
    const transport = await this.transportFactory.connect(key.containerId, launchSpec);
    const client = this.clientHostFactory.create({ agentId: key.agentId, containerId: key.containerId }, sink);
    const connection = new ClientSideConnection(() => client, transport.stream);
    const initResult = await connection.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {
        fs: {
          readTextFile: true,
          writeTextFile: true,
        },
      },
    });

    this.logger.debug(`ACP initialized for agent ${key.agentId} (protocol v${initResult.protocolVersion})`);

    let acpSessionId: string;

    if (launchSpec.supportsLoadSession) {
      try {
        await connection.loadSession({
          sessionId: resumeId,
          cwd: launchSpec.cwd,
          mcpServers: [],
        });

        acpSessionId = resumeId;
      } catch (loadError) {
        const err = loadError as { message?: string };

        this.logger.debug(`ACP loadSession failed, creating new session: ${err.message}`);
        const created = await connection.newSession({
          cwd: launchSpec.cwd,
          mcpServers: [],
        });

        acpSessionId = created.sessionId;
      }
    } else {
      const created = await connection.newSession({
        cwd: launchSpec.cwd,
        mcpServers: [],
      });

      acpSessionId = created.sessionId;
    }

    const managed: ManagedAcpSession = {
      connection,
      transport,
      acpSessionId,
      resumeId,
    };

    this.sessions.set(mapKey, managed);

    return managed;
  }
}
