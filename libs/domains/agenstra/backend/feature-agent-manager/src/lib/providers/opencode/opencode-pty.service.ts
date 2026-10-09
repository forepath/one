import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import { OpenCodeClientFactory } from './opencode-client.factory';
import {
  OPENCODE_PTY_CONNECT_TOKEN_HEADER,
  OPENCODE_PTY_CONNECT_TOKEN_HEADER_VALUE,
  OPENCODE_PTY_DIRECTORY_DEFAULT,
} from './opencode-provider.config';

interface OpenCodePtyInfo {
  id: string;
  title?: string;
  command?: string;
  status?: string;
}

interface PtyTicketConnectToken {
  ticket: string;
  expires_in?: number;
}

export interface OpenCodePtyOpenOptions {
  shell?: string;
  cols?: number;
  rows?: number;
}

export interface OpenCodePtySessionCallbacks {
  onOutput: (data: string) => void;
  onClosed: () => void;
}

interface ActivePtySession {
  ptyID: string;
  agentId: string;
  containerId: string;
  authorization: string;
  baseUrl: string;
  ws: WebSocket;
  callbacks: OpenCodePtySessionCallbacks;
  closedNotified: boolean;
}

@Injectable()
export class OpenCodePtyService {
  private readonly logger = new Logger(OpenCodePtyService.name);
  private readonly sessions = new Map<string, ActivePtySession>();

  constructor(private readonly clientFactory: OpenCodeClientFactory) {}

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  async open(
    agentId: string,
    containerId: string,
    sessionId: string,
    options: OpenCodePtyOpenOptions,
    callbacks: OpenCodePtySessionCallbacks,
  ): Promise<void> {
    if (this.sessions.has(sessionId)) {
      await this.close(sessionId);
    }

    await this.clientFactory.waitForHealthy(agentId, containerId, { timeoutMs: 30_000 });

    const { baseUrl, authorization } = await this.clientFactory.resolveConnection(agentId, containerId);
    const shell = options.shell?.trim() || undefined;

    const pty = await this.createPty(baseUrl, authorization, shell, options.cols, options.rows);
    const ticket = await this.createConnectToken(baseUrl, authorization, pty.id);
    const ws = await this.connectWebSocket(baseUrl, pty.id, ticket.ticket, callbacks.onOutput);

    const session: ActivePtySession = {
      ptyID: pty.id,
      agentId,
      containerId,
      authorization,
      baseUrl,
      ws,
      callbacks,
      closedNotified: false,
    };

    ws.addEventListener('close', () => {
      this.notifyClosed(sessionId);
    });

    ws.addEventListener('error', () => {
      this.notifyClosed(sessionId);
    });

    this.sessions.set(sessionId, session);
    this.logger.log(`OpenCode PTY session ${sessionId} → pty ${pty.id} for agent ${agentId}`);
  }

  async write(sessionId: string, data: string): Promise<void> {
    const session = this.getSessionOrThrow(sessionId);

    if (session.ws.readyState !== WebSocket.OPEN) {
      throw new NotFoundException(`Terminal session '${sessionId}' is not connected`);
    }

    session.ws.send(data);
  }

  async resize(sessionId: string, cols: number, rows: number): Promise<void> {
    const session = this.getSessionOrThrow(sessionId);

    if (cols < 1 || rows < 1) {
      return;
    }

    const response = await fetch(this.ptyResourceUrl(session.baseUrl, session.ptyID), {
      method: 'PATCH',
      headers: {
        Authorization: session.authorization,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ size: { cols, rows } }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');

      this.logger.warn(
        `OpenCode PTY resize failed for session ${sessionId}: ${response.status}${detail ? ` ${detail}` : ''}`,
      );
    }
  }

  async close(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);

    if (!session) {
      throw new NotFoundException(`Terminal session '${sessionId}' not found`);
    }

    this.sessions.delete(sessionId);

    try {
      if (session.ws.readyState === WebSocket.OPEN || session.ws.readyState === WebSocket.CONNECTING) {
        session.ws.close();
      }
    } catch (error) {
      const err = error as { message?: string };

      this.logger.debug(`WebSocket close for session ${sessionId}: ${err.message}`);
    }

    await this.removePty(session.baseUrl, session.authorization, session.ptyID);
    this.logger.log(`Closed OpenCode PTY session ${sessionId}`);
  }

  async closeAll(sessionIds: Iterable<string>): Promise<void> {
    for (const sessionId of sessionIds) {
      try {
        await this.close(sessionId);
      } catch (error) {
        const err = error as { message?: string };

        if (!err.message?.includes('not found')) {
          this.logger.warn(`Failed to close PTY session ${sessionId}: ${err.message}`);
        }
      }
    }
  }

  private getSessionOrThrow(sessionId: string): ActivePtySession {
    const session = this.sessions.get(sessionId);

    if (!session) {
      throw new NotFoundException(`Terminal session '${sessionId}' not found`);
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
    session.callbacks.onClosed();

    void this.removePty(session.baseUrl, session.authorization, session.ptyID).catch((error) => {
      const err = error as { message?: string };

      this.logger.debug(`PTY cleanup after close for ${sessionId}: ${err.message}`);
    });
  }

  private ptyOrigin(baseUrl: string): string {
    return baseUrl.replace(/\/$/, '');
  }

  private ptyQuery(): URLSearchParams {
    return new URLSearchParams({ directory: OPENCODE_PTY_DIRECTORY_DEFAULT });
  }

  private ptyResourceUrl(baseUrl: string, ptyID: string, suffix = ''): string {
    const path = `/pty/${encodeURIComponent(ptyID)}${suffix}`;
    const query = this.ptyQuery().toString();

    return `${baseUrl}${path}?${query}`;
  }

  private parsePty(body: unknown): OpenCodePtyInfo {
    const wrapped = body as { id?: string; data?: OpenCodePtyInfo };

    if (wrapped.data?.id) {
      return wrapped.data;
    }

    if (wrapped.id) {
      return body as OpenCodePtyInfo;
    }

    throw new Error('OpenCode PTY create returned an unexpected payload');
  }

  private parseConnectToken(body: unknown): PtyTicketConnectToken {
    const wrapped = body as { ticket?: string; data?: PtyTicketConnectToken };

    if (wrapped.data?.ticket) {
      return wrapped.data;
    }

    if (wrapped.ticket) {
      return body as PtyTicketConnectToken;
    }

    throw new Error('OpenCode PTY connect-token returned an unexpected payload');
  }

  private async createPty(
    baseUrl: string,
    authorization: string,
    shell: string | undefined,
    cols?: number,
    rows?: number,
  ): Promise<OpenCodePtyInfo> {
    const createUrl = `${baseUrl}/pty?${this.ptyQuery().toString()}`;
    const response = await fetch(createUrl, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json',
      },
      // Omit `command` so OpenCode uses config.shell / its preferred shell (e.g. bash).
      body: JSON.stringify({
        title: 'Agenstra console',
        ...(shell ? { command: shell } : {}),
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');

      throw new Error(`OpenCode PTY create failed: ${response.status}${detail ? ` ${detail}` : ''}`);
    }

    const pty = this.parsePty(await response.json());

    if (cols && rows && cols > 0 && rows > 0) {
      await fetch(this.ptyResourceUrl(baseUrl, pty.id), {
        method: 'PATCH',
        headers: {
          Authorization: authorization,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ size: { cols, rows } }),
      });
    }

    return pty;
  }

  private async createConnectToken(
    baseUrl: string,
    authorization: string,
    ptyID: string,
  ): Promise<PtyTicketConnectToken> {
    const origin = this.ptyOrigin(baseUrl);
    const response = await fetch(this.ptyResourceUrl(baseUrl, ptyID, '/connect-token'), {
      method: 'POST',
      headers: {
        Authorization: authorization,
        Origin: origin,
        [OPENCODE_PTY_CONNECT_TOKEN_HEADER]: OPENCODE_PTY_CONNECT_TOKEN_HEADER_VALUE,
      },
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');

      throw new Error(`OpenCode PTY connect-token failed: ${response.status}${detail ? ` ${detail}` : ''}`);
    }

    return this.parseConnectToken(await response.json());
  }

  private async connectWebSocket(
    baseUrl: string,
    ptyID: string,
    ticket: string,
    onOutput: (chunk: string) => void,
  ): Promise<WebSocket> {
    const wsBase = baseUrl.replace(/^http/i, 'ws');
    const params = this.ptyQuery();

    params.set('ticket', ticket);
    const url = `${wsBase}/pty/${encodeURIComponent(ptyID)}/connect?${params.toString()}`;
    const origin = this.ptyOrigin(baseUrl);

    type WebSocketCtor = new (
      url: string,
      protocols?: string | string[] | { headers?: Record<string, string> },
    ) => WebSocket;

    return new Promise((resolve, reject) => {
      const ws = new (WebSocket as WebSocketCtor)(url, { headers: { Origin: origin } });

      ws.addEventListener('message', (event) => {
        this.forwardPtyOutput(event.data, onOutput);
      });
      ws.addEventListener('open', () => resolve(ws));
      ws.addEventListener('error', () => reject(new Error('OpenCode PTY WebSocket connection failed')));
    });
  }

  private async removePty(baseUrl: string, authorization: string, ptyID: string): Promise<void> {
    const response = await fetch(this.ptyResourceUrl(baseUrl, ptyID), {
      method: 'DELETE',
      headers: { Authorization: authorization },
    });

    if (!response.ok && response.status !== 404) {
      const detail = await response.text().catch(() => '');

      this.logger.warn(`OpenCode PTY delete failed for ${ptyID}: ${response.status}${detail ? ` ${detail}` : ''}`);
    }
  }

  private forwardPtyOutput(data: unknown, onOutput: (chunk: string) => void): void {
    if (typeof Blob !== 'undefined' && data instanceof Blob) {
      void data.arrayBuffer().then((buffer) => {
        const text = this.decodePtyBytes(new Uint8Array(buffer));

        if (text.length > 0) {
          onOutput(text);
        }
      });

      return;
    }

    const bytes = this.syncMessageDataToBytes(data);
    const text = this.decodePtyBytes(bytes);

    if (text.length > 0) {
      onOutput(text);
    }
  }

  /**
   * OpenCode PTY WebSocket: terminal chunks are raw UTF-8; control frames are
   * `0x00` + JSON (e.g. `{"cursor":n}`) and must not be shown in xterm.
   */
  private decodePtyBytes(bytes: Uint8Array | null): string {
    if (!bytes || bytes.length === 0) {
      return '';
    }

    if (bytes[0] === 0) {
      return '';
    }

    return Buffer.from(bytes).toString('utf-8');
  }

  private syncMessageDataToBytes(data: unknown): Uint8Array | null {
    if (typeof data === 'string') {
      return Buffer.from(data, 'utf-8');
    }

    if (data instanceof ArrayBuffer) {
      return new Uint8Array(data);
    }

    if (ArrayBuffer.isView(data)) {
      return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }

    return null;
  }
}
