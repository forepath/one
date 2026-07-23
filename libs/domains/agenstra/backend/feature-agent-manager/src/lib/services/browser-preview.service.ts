import { Injectable, Logger } from '@nestjs/common';
import { WebSocket } from 'ws';

import { DockerService } from './docker.service';

const CDP_PORT = 9222;
const MAX_FRAME_BYTES = 512_000;
/** Match a typical Preview modal content area (not full 1080p chrome). */
const PREVIEW_VIEWPORT_WIDTH = 1910;
const PREVIEW_VIEWPORT_HEIGHT = 865;
/** Cap encoded frame size for Socket.IO; input still maps via metadata device size. */
const SCREENCAST_MAX_WIDTH = 1280;
const SCREENCAST_MAX_HEIGHT = 720;
const SCREENCAST_EVERY_NTH = 2;
const SCREENCAST_QUALITY = 45;
const CDP_READY_TIMEOUT_MS = 60_000;
const CDP_READY_POLL_MS = 500;

export type BrowserPreviewMouseInput = {
  type: 'mousePressed' | 'mouseReleased' | 'mouseMoved' | 'mouseWheel';
  x: number;
  y: number;
  button?: 'none' | 'left' | 'middle' | 'right';
  buttons?: number;
  clickCount?: number;
  deltaX?: number;
  deltaY?: number;
  modifiers?: number;
};

export type BrowserPreviewKeyInput = {
  type: 'keyDown' | 'keyUp' | 'rawKeyDown' | 'char';
  text?: string;
  unmodifiedText?: string;
  key?: string;
  code?: string;
  windowsVirtualKeyCode?: number;
  nativeVirtualKeyCode?: number;
  modifiers?: number;
};

export type BrowserPreviewInput =
  | { kind: 'mouse'; event: BrowserPreviewMouseInput }
  | { kind: 'key'; event: BrowserPreviewKeyInput };

export type BrowserPreviewFrame = {
  sessionId: string;
  data: string;
  metadata: {
    offsetTop: number;
    pageScaleFactor: number;
    deviceWidth: number;
    deviceHeight: number;
    scrollOffsetX: number;
    scrollOffsetY: number;
    timestamp: number;
  };
};

export type BrowserPreviewLocation = {
  sessionId: string;
  url: string;
  canGoBack: boolean;
  canGoForward: boolean;
};

export type BrowserPreviewCommand =
  | { type: 'navigate'; url: string }
  | { type: 'reload' }
  | { type: 'back' }
  | { type: 'forward' };

type CdpTargetInfo = {
  id: string;
  type?: string;
  webSocketDebuggerUrl?: string;
};

type CdpSession = {
  sessionId: string;
  agentId: string;
  socketId: string;
  ws: WebSocket;
  containerIp: string;
  cdpTargetId: string;
  ownsTarget: boolean;
  networkId?: string;
  managerContainerId?: string;
  joinedNetwork: boolean;
  nextCommandId: number;
  pending: Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>;
  onFrame: (frame: BrowserPreviewFrame) => void;
  onLocation: (location: BrowserPreviewLocation) => void;
  onClosed: () => void;
};

/**
 * Manages browser-only Preview sessions via Chromium CDP inside the VNC sidecar.
 * CDP port 9222 stays internal; the manager joins the agent Docker network for the session.
 */
@Injectable()
export class BrowserPreviewService {
  private readonly logger = new Logger(BrowserPreviewService.name);
  private readonly sessionsById = new Map<string, CdpSession>();
  private readonly sessionsBySocket = new Map<string, Set<string>>();

  constructor(private readonly dockerService: DockerService) {}

  async startSession(options: {
    sessionId: string;
    agentId: string;
    socketId: string;
    vncContainerId: string;
    networkId?: string;
    onFrame: (frame: BrowserPreviewFrame) => void;
    onLocation: (location: BrowserPreviewLocation) => void;
    onClosed: () => void;
  }): Promise<void> {
    const { sessionId, agentId, socketId, vncContainerId, networkId, onFrame, onLocation, onClosed } = options;

    if (this.sessionsById.has(sessionId)) {
      throw new Error('Browser preview session already exists');
    }

    const managerContainerId = this.dockerService.getManagerContainerId();
    let joinedNetwork = false;
    let containerIp: string | undefined;
    let createdTarget: CdpTargetInfo | undefined;

    if (networkId && managerContainerId) {
      await this.dockerService.connectContainerToNetwork(managerContainerId, networkId);
      joinedNetwork = true;
    }

    try {
      const ip = await this.waitForCdpReady(vncContainerId, networkId);

      containerIp = ip;
      createdTarget = await this.createFreshPageTarget(ip);

      if (!createdTarget.webSocketDebuggerUrl) {
        throw new Error('Chromium page CDP endpoint is not ready');
      }

      // Chromium reports loopback in webSocketDebuggerUrl; reach it via container IP + socat proxy.
      const wsUrl = this.rewriteCdpWebSocketUrl(createdTarget.webSocketDebuggerUrl, ip);
      const ws = await this.openWebSocket(wsUrl);
      const session: CdpSession = {
        sessionId,
        agentId,
        socketId,
        ws,
        containerIp: ip,
        cdpTargetId: createdTarget.id,
        ownsTarget: true,
        networkId,
        managerContainerId,
        joinedNetwork,
        nextCommandId: 1,
        pending: new Map(),
        onFrame,
        onLocation,
        onClosed,
      };

      ws.on('message', (data) => this.handleMessage(session, data));
      ws.on('close', () => {
        void this.cleanupSession(sessionId, false);
      });
      ws.on('error', () => {
        void this.cleanupSession(sessionId, true);
      });

      this.sessionsById.set(sessionId, session);
      let socketSessions = this.sessionsBySocket.get(socketId);

      if (!socketSessions) {
        socketSessions = new Set<string>();
        this.sessionsBySocket.set(socketId, socketSessions);
      }

      socketSessions.add(sessionId);
      createdTarget = undefined;

      await this.sendCommand(session, 'Page.enable');
      await this.sendCommand(session, 'Emulation.setDeviceMetricsOverride', {
        width: PREVIEW_VIEWPORT_WIDTH,
        height: PREVIEW_VIEWPORT_HEIGHT,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await this.sendCommand(session, 'Page.bringToFront').catch(() => undefined);
      await this.sendCommand(session, 'Page.startScreencast', {
        format: 'jpeg',
        quality: SCREENCAST_QUALITY,
        everyNthFrame: SCREENCAST_EVERY_NTH,
        maxWidth: SCREENCAST_MAX_WIDTH,
        maxHeight: SCREENCAST_MAX_HEIGHT,
      });
      await this.emitLocation(session);
    } catch (error) {
      if (createdTarget && containerIp) {
        await this.closeCdpTargetHttp(containerIp, createdTarget.id);
      }

      if (joinedNetwork && networkId && managerContainerId) {
        await this.dockerService.disconnectContainerFromNetwork(managerContainerId, networkId);
      }

      throw error;
    }
  }

  async stopSession(sessionId: string): Promise<void> {
    await this.cleanupSession(sessionId, true);
  }

  async stopSessionsForSocket(socketId: string): Promise<void> {
    const sessionIds = this.sessionsBySocket.get(socketId);

    if (!sessionIds) {
      return;
    }

    for (const sessionId of [...sessionIds]) {
      await this.cleanupSession(sessionId, true);
    }
  }

  hasSession(sessionId: string, socketId: string): boolean {
    const session = this.sessionsById.get(sessionId);

    return !!session && session.socketId === socketId;
  }

  async dispatchInput(sessionId: string, input: BrowserPreviewInput): Promise<void> {
    const session = this.sessionsById.get(sessionId);

    if (!session) {
      throw new Error('Browser preview session not found');
    }

    if (input.kind === 'mouse') {
      const event = this.normalizeMouseInput(input.event);

      await this.sendCommand(session, 'Input.dispatchMouseEvent', event);

      return;
    }

    const event = this.normalizeKeyInput(input.event);

    await this.sendCommand(session, 'Input.dispatchKeyEvent', event);
  }

  async dispatchCommand(sessionId: string, command: BrowserPreviewCommand): Promise<void> {
    const session = this.sessionsById.get(sessionId);

    if (!session) {
      throw new Error('Browser preview session not found');
    }

    switch (command.type) {
      case 'navigate': {
        const url = this.normalizeNavigateUrl(command.url);

        if (!url) {
          throw new Error('Invalid navigation URL');
        }

        await this.sendCommand(session, 'Page.navigate', { url });
        break;
      }
      case 'reload':
        await this.sendCommand(session, 'Page.reload', {});
        break;
      case 'back':
      case 'forward': {
        const history = (await this.sendCommand(session, 'Page.getNavigationHistory', {})) as {
          currentIndex?: number;
          entries?: Array<{ id: number; url?: string }>;
        };
        const currentIndex = typeof history.currentIndex === 'number' ? history.currentIndex : -1;
        const entries = Array.isArray(history.entries) ? history.entries : [];
        const nextIndex = command.type === 'back' ? currentIndex - 1 : currentIndex + 1;
        const entry = entries[nextIndex];

        if (!entry || typeof entry.id !== 'number') {
          return;
        }

        await this.sendCommand(session, 'Page.navigateToHistoryEntry', { entryId: entry.id });
        break;
      }
      default:
        throw new Error('Unsupported browser preview command');
    }

    await this.emitLocation(session);
  }

  private normalizeNavigateUrl(raw: string): string | null {
    const trimmed = typeof raw === 'string' ? raw.trim() : '';

    if (!trimmed || trimmed.length > 2048) {
      return null;
    }

    try {
      const url = new URL(trimmed);

      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return null;
      }

      return url.toString();
    } catch {
      return null;
    }
  }

  private async emitLocation(session: CdpSession): Promise<void> {
    try {
      const history = (await this.sendCommand(session, 'Page.getNavigationHistory', {})) as {
        currentIndex?: number;
        entries?: Array<{ id: number; url?: string }>;
      };
      const currentIndex = typeof history.currentIndex === 'number' ? history.currentIndex : -1;
      const entries = Array.isArray(history.entries) ? history.entries : [];
      const current = entries[currentIndex];
      const url = typeof current?.url === 'string' ? current.url : 'about:blank';

      session.onLocation({
        sessionId: session.sessionId,
        url,
        canGoBack: currentIndex > 0,
        canGoForward: currentIndex >= 0 && currentIndex < entries.length - 1,
      });
    } catch (error) {
      const err = error as { message?: string };

      this.logger.warn(`Failed to read browser preview location for ${session.sessionId}: ${err.message}`);
    }
  }

  private normalizeMouseInput(event: BrowserPreviewMouseInput): BrowserPreviewMouseInput {
    const allowedTypes = new Set(['mousePressed', 'mouseReleased', 'mouseMoved', 'mouseWheel']);

    if (!allowedTypes.has(event.type)) {
      throw new Error('Invalid mouse event type');
    }

    if (!Number.isFinite(event.x) || !Number.isFinite(event.y)) {
      throw new Error('Invalid mouse coordinates');
    }

    const allowedButtons = new Set(['none', 'left', 'middle', 'right']);
    const button = event.button && allowedButtons.has(event.button) ? event.button : 'none';

    return {
      type: event.type,
      x: Math.max(0, Math.min(event.x, 10000)),
      y: Math.max(0, Math.min(event.y, 10000)),
      button,
      buttons: typeof event.buttons === 'number' ? event.buttons & 0xff : 0,
      clickCount: typeof event.clickCount === 'number' ? Math.min(Math.max(event.clickCount, 1), 3) : 1,
      deltaX: typeof event.deltaX === 'number' ? event.deltaX : undefined,
      deltaY: typeof event.deltaY === 'number' ? event.deltaY : undefined,
      modifiers: typeof event.modifiers === 'number' ? event.modifiers & 0xff : 0,
    };
  }

  private normalizeKeyInput(event: BrowserPreviewKeyInput): BrowserPreviewKeyInput {
    const allowedTypes = new Set(['keyDown', 'keyUp', 'rawKeyDown', 'char']);

    if (!allowedTypes.has(event.type)) {
      throw new Error('Invalid key event type');
    }

    const text = event.text?.slice(0, 32);
    const unmodifiedText = event.unmodifiedText?.slice(0, 32);
    const key = event.key?.slice(0, 64);
    const code = event.code?.slice(0, 64);

    return {
      type: event.type,
      text,
      unmodifiedText,
      key,
      code,
      windowsVirtualKeyCode:
        typeof event.windowsVirtualKeyCode === 'number' ? event.windowsVirtualKeyCode & 0xffff : undefined,
      nativeVirtualKeyCode:
        typeof event.nativeVirtualKeyCode === 'number' ? event.nativeVirtualKeyCode & 0xffff : undefined,
      modifiers: typeof event.modifiers === 'number' ? event.modifiers & 0xff : 0,
    };
  }

  private handleMessage(session: CdpSession, raw: unknown): void {
    let message: {
      id?: number;
      result?: unknown;
      error?: { message?: string };
      method?: string;
      params?: {
        data?: string;
        sessionId?: number;
        metadata?: BrowserPreviewFrame['metadata'];
      };
    };

    try {
      const text = typeof raw === 'string' ? raw : Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);

      message = JSON.parse(text) as typeof message;
    } catch {
      return;
    }

    if (typeof message.id === 'number') {
      const pending = session.pending.get(message.id);

      if (pending) {
        session.pending.delete(message.id);

        if (message.error) {
          pending.reject(new Error(message.error.message || 'CDP command failed'));
        } else {
          pending.resolve(message.result);
        }
      }

      return;
    }

    if (message.method === 'Page.screencastFrame' && message.params?.data && message.params.metadata) {
      const data = message.params.data;

      if (data.length > MAX_FRAME_BYTES) {
        this.logger.warn(`Dropping oversized browser preview frame for session ${session.sessionId}`);
      } else {
        session.onFrame({
          sessionId: session.sessionId,
          data,
          metadata: message.params.metadata,
        });
      }

      const ackSessionId = message.params.sessionId;

      if (typeof ackSessionId === 'number') {
        void this.sendCommand(session, 'Page.screencastFrameAck', { sessionId: ackSessionId }).catch(() => undefined);
      }

      return;
    }

    if (message.method === 'Page.frameNavigated') {
      const frame = (message as { params?: { frame?: { parentId?: string; url?: string } } }).params?.frame;

      // Only react to top-level navigations.
      if (frame && !frame.parentId) {
        void this.emitLocation(session);
      }
    }
  }

  private async sendCommand(session: CdpSession, method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (session.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Browser preview session is not connected');
    }

    const id = session.nextCommandId++;

    return await new Promise((resolve, reject) => {
      session.pending.set(id, { resolve, reject });
      session.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  private async cleanupSession(sessionId: string, closeWs: boolean): Promise<void> {
    const session = this.sessionsById.get(sessionId);

    if (!session) {
      return;
    }

    this.sessionsById.delete(sessionId);
    const socketSessions = this.sessionsBySocket.get(session.socketId);

    if (socketSessions) {
      socketSessions.delete(sessionId);

      if (socketSessions.size === 0) {
        this.sessionsBySocket.delete(session.socketId);
      }
    }

    if (session.ownsTarget && session.ws.readyState === WebSocket.OPEN) {
      try {
        await Promise.race([
          (async () => {
            await this.sendCommand(session, 'Page.stopScreencast', {}).catch(() => undefined);
            await this.sendCommand(session, 'Page.close', {});
          })(),
          new Promise<void>((resolve) => setTimeout(resolve, 2000)),
        ]);
      } catch {
        // Fall through to HTTP close.
      }
    }

    if (session.ownsTarget) {
      await this.closeCdpTargetHttp(session.containerIp, session.cdpTargetId);
    }

    if (closeWs && session.ws.readyState === WebSocket.OPEN) {
      try {
        session.ws.close();
      } catch {
        // ignore
      }
    }

    for (const [, pending] of session.pending) {
      pending.reject(new Error('Browser preview session closed'));
    }

    session.pending.clear();

    if (session.joinedNetwork && session.networkId && session.managerContainerId) {
      await this.dockerService.disconnectContainerFromNetwork(session.managerContainerId, session.networkId);
    }

    session.onClosed();
  }

  private async waitForCdpReady(vncContainerId: string, networkId?: string): Promise<string> {
    const deadline = Date.now() + CDP_READY_TIMEOUT_MS;
    let lastError: unknown;

    while (Date.now() < deadline) {
      try {
        const ip = await this.dockerService.getContainerIpAddress(vncContainerId, networkId);
        const version = await this.fetchJson<{ webSocketDebuggerUrl?: string }>(
          `http://${ip}:${CDP_PORT}/json/version`,
        );

        if (version?.webSocketDebuggerUrl) {
          return ip;
        }
      } catch (error) {
        lastError = error;
      }

      await new Promise((resolve) => setTimeout(resolve, CDP_READY_POLL_MS));
    }

    this.logger.error(`Timed out waiting for Chromium CDP on container ${vncContainerId}`);
    throw lastError instanceof Error ? lastError : new Error('Chromium CDP is not available');
  }

  /**
   * Open a dedicated about:blank tab for this Preview session (do not reuse the desktop window).
   */
  private async createFreshPageTarget(ip: string): Promise<CdpTargetInfo> {
    const newUrl = `http://${ip}:${CDP_PORT}/json/new?${encodeURIComponent('about:blank')}`;

    try {
      const created = await this.fetchJson<CdpTargetInfo>(newUrl, { method: 'PUT' });

      if (created?.id && created.webSocketDebuggerUrl) {
        return created;
      }
    } catch {
      // Older Chromium builds only accept GET /json/new.
    }

    const createdGet = await this.fetchJson<CdpTargetInfo>(newUrl, { method: 'GET' });

    if (createdGet?.id && createdGet.webSocketDebuggerUrl) {
      return createdGet;
    }

    throw new Error('Failed to create a fresh Chromium page for browser preview');
  }

  private async closeCdpTargetHttp(ip: string, targetId: string): Promise<void> {
    const safeId = encodeURIComponent(targetId);
    const url = `http://${ip}:${CDP_PORT}/json/close/${safeId}`;

    try {
      await this.fetchJson<unknown>(url, { method: 'PUT' });
    } catch {
      try {
        await this.fetchJson<unknown>(url, { method: 'GET' });
      } catch (error) {
        const err = error as { message?: string };

        this.logger.warn(`Failed to close CDP target ${targetId}: ${err.message}`);
      }
    }
  }

  private async fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      throw new Error(`CDP HTTP ${response.status}`);
    }

    const text = await response.text();

    if (!text) {
      return {} as T;
    }

    return JSON.parse(text) as T;
  }

  private rewriteCdpWebSocketUrl(debuggerUrl: string, containerIp: string): string {
    const rewritten = new URL(debuggerUrl);

    rewritten.hostname = containerIp;
    rewritten.port = String(CDP_PORT);

    return rewritten.toString();
  }

  private openWebSocket(url: string): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const onOpen = () => {
        cleanup();
        resolve(ws);
      };
      const onError = () => {
        cleanup();
        reject(new Error('Failed to open CDP WebSocket'));
      };
      const cleanup = () => {
        ws.off('open', onOpen);
        ws.off('error', onError);
      };

      ws.on('open', onOpen);
      ws.on('error', onError);
    });
  }
}
