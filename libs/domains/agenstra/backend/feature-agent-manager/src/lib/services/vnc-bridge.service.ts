import { Injectable, Logger, NotFoundException, OnModuleDestroy } from '@nestjs/common';
import WebSocket = require('ws');

import { VNC_WEBSOCKIFY_PORT } from '../constants/vnc.constants';
import { OpenCodeClientFactory } from '../providers/opencode/opencode-client.factory';

import { DockerService } from './docker.service';

export interface VncBridgeCallbacks {
  onMessage: (data: WebSocket.RawData, isBinary: boolean) => void;
  onClose: () => void;
  onError: (error: Error) => void;
}

interface ActiveVncBridgeSession {
  sessionId: string;
  agentId: string;
  containerId: string;
  upstream: WebSocket;
  callbacks: VncBridgeCallbacks;
  closedNotified: boolean;
}

@Injectable()
export class VncBridgeService implements OnModuleDestroy {
  private readonly logger = new Logger(VncBridgeService.name);
  private readonly sessions = new Map<string, ActiveVncBridgeSession>();

  constructor(
    private readonly dockerService: DockerService,
    private readonly openCodeClientFactory: OpenCodeClientFactory,
  ) {}

  onModuleDestroy(): void {
    for (const sessionId of [...this.sessions.keys()]) {
      this.close(sessionId);
    }
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  async open(sessionId: string, agentId: string, containerId: string, callbacks: VncBridgeCallbacks): Promise<void> {
    if (this.sessions.has(sessionId)) {
      this.close(sessionId);
    }

    const httpBase = await this.dockerService.resolveContainerHttpBaseUrl(containerId, VNC_WEBSOCKIFY_PORT);
    const wsUrl = httpBase.replace(/^http/i, 'ws');
    const { authorization } = await this.openCodeClientFactory.resolveConnection(agentId, containerId);

    await new Promise<void>((resolve, reject) => {
      const upstream = new WebSocket(wsUrl, {
        headers: {
          Authorization: authorization,
        },
      });
      const session: ActiveVncBridgeSession = {
        sessionId,
        agentId,
        containerId,
        upstream,
        callbacks,
        closedNotified: false,
      };

      // Register session + handlers before 'open' so the immediate RFB greeting is not dropped.
      this.sessions.set(sessionId, session);

      upstream.on('message', (data, isBinary) => {
        if (!this.sessions.has(sessionId)) {
          return;
        }

        callbacks.onMessage(data, isBinary);
      });

      upstream.on('close', () => {
        this.notifyClosed(sessionId);
      });

      upstream.on('error', (error) => {
        this.logger.warn(`Upstream VNC WebSocket error for session ${sessionId}: ${error.message}`);
        callbacks.onError(error);
        this.notifyClosed(sessionId);
      });

      const onOpen = () => {
        cleanup();
        this.logger.log(`Opened VNC bridge session ${sessionId} for agent ${agentId}`);
        resolve();
      };

      const onError = (error: Error) => {
        cleanup();
        this.sessions.delete(sessionId);
        reject(error);
      };

      const cleanup = () => {
        upstream.off('open', onOpen);
        upstream.off('error', onError);
      };

      upstream.once('open', onOpen);
      upstream.once('error', onError);
    });
  }

  send(sessionId: string, data: WebSocket.RawData, isBinary: boolean): void {
    const session = this.getSessionOrThrow(sessionId);

    if (session.upstream.readyState !== WebSocket.OPEN) {
      throw new NotFoundException(`VNC session '${sessionId}' is not connected`);
    }

    session.upstream.send(data, { binary: isBinary });
  }

  close(sessionId: string): void {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return;
    }

    this.sessions.delete(sessionId);

    try {
      if (session.upstream.readyState === WebSocket.OPEN || session.upstream.readyState === WebSocket.CONNECTING) {
        session.upstream.close();
      }
    } catch (error) {
      const err = error as { message?: string };

      this.logger.debug(`VNC upstream close for session ${sessionId}: ${err.message}`);
    }
  }

  private getSessionOrThrow(sessionId: string): ActiveVncBridgeSession {
    const session = this.sessions.get(sessionId);

    if (!session) {
      throw new NotFoundException(`VNC session '${sessionId}' not found`);
    }

    return session;
  }

  private notifyClosed(sessionId: string): void {
    const session = this.sessions.get(sessionId);

    if (!session || session.closedNotified) {
      return;
    }

    session.closedNotified = true;
    this.sessions.delete(sessionId);
    session.callbacks.onClose();
  }
}
