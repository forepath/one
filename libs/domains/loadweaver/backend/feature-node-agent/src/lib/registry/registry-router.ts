import { randomUUID } from 'node:crypto';
import { createServer, request, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  agentMessage,
  type Envelope,
  type RegistryClient,
  type RegistryToken,
} from '@forepath/loadweaver/shared/util-agent-protocol';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';

/** Issues a pull token for private repositories (over the agent stream; the control plane checks them). */
export type RegistryTokenProvider = (repositories: string[]) => Promise<{ token: string; expiresInSeconds: number }>;

const PATH =
  /^\/v2\/([a-z0-9.-]+(?::\d{1,5})?)\/([a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*)\/(manifests|blobs)\/([A-Za-z0-9_.:-]{1,128})$/;
const FORWARDED_REQUEST_HEADERS = ['accept', 'range', 'if-none-match', 'if-modified-since', 'user-agent'];
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
]);
const RETRYABLE_STATUS = new Set([502, 503, 504]);
const CONNECT_TIMEOUT_MS = 5_000;
const IDLE_TIMEOUT_MS = 60_000;
const TOKEN_MARGIN_MS = 30_000;
const TOKEN_TIMEOUT_MS = 15_000;

export interface RouteTarget {
  port: number;
  path: string;
  repository: string;
  private: boolean;
}

/** Maps a router path to the registry instance behind it; null = not routed here. */
export function routeRequest(path: string, client: RegistryClient): RouteTarget | null {
  const match = PATH.exec(path);

  if (!match) return null;

  const [, host, repository, kind, reference] = match;
  const upstream = `/v2/${repository}/${kind}/${reference}`;

  if (host === client.privateHost) return { port: client.privatePort, path: upstream, repository, private: true };

  const mirror = client.mirrors.find((m) => m.host === host);

  return mirror ? { port: mirror.port, path: upstream, repository, private: false } : null;
}

function registryError(res: ServerResponse, status: number, code: string, message: string): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Docker-Distribution-API-Version': 'registry/2.0' });
  res.end(JSON.stringify({ errors: [{ code, message }] }));
}

/**
 * Pull router on `127.0.0.1` (3.22): Docker treats loopback registries as trusted without TLS, the router forwards
 * to the registry instances on the control-plane members over the overlay (WireGuard), failing over between them.
 * Read-only (GET / HEAD); private repositories only for the node's own workloads, with a short-lived pull token.
 */
@Injectable()
export class RegistryRouter implements OnModuleDestroy {
  private readonly logger = new Logger(RegistryRouter.name);
  private server: Server | null = null;
  private port: number | null = null;
  private requestedPort: number | null = null;
  private client: RegistryClient | null = null;
  private allowed = new Set<string>();
  private readonly tokens = new Map<string, { token: string; expiresAt: number }>();
  private preferred = 0;
  private send: ((envelope: Envelope) => void) | null = null;
  private readonly pending = new Map<
    string,
    {
      resolve: (token: { token: string; expiresInSeconds: number }) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  tokenProvider: RegistryTokenProvider | null = null;

  /** Pull tokens come over the agent stream. */
  attach(send: (envelope: Envelope) => void): void {
    this.send = send;
    this.tokenProvider ??= (repositories) => this.requestToken(repositories);
  }

  private async requestToken(repositories: string[]): Promise<{ token: string; expiresInSeconds: number }> {
    if (!this.send) throw new Error('not connected to the control plane');

    const requestId = randomUUID();

    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error('pull token not delivered in time'));
      }, TOKEN_TIMEOUT_MS);

      this.pending.set(requestId, { resolve, reject, timer });
      this.send?.(agentMessage('registryTokenRequest', { requestId, repositories }));
    });
  }

  /** Called by the connection for `registryToken` replies. */
  deliver(payload: RegistryToken): void {
    const pending = this.pending.get(payload.requestId);

    if (!pending) return;

    clearTimeout(pending.timer);
    this.pending.delete(payload.requestId);

    if (payload.token && payload.expiresInSeconds)
      pending.resolve({ token: payload.token, expiresInSeconds: payload.expiresInSeconds });
    else pending.reject(new Error(payload.error ?? 'pull token refused'));
  }

  async apply(client: RegistryClient | undefined, privateRepositories: ReadonlySet<string>): Promise<boolean> {
    this.allowed = new Set(privateRepositories);

    for (const repository of [...this.tokens.keys()]) if (!this.allowed.has(repository)) this.tokens.delete(repository);

    if (!client) {
      this.client = null;

      return await this.stop();
    }

    this.client = client;

    if (this.server && this.requestedPort === client.routerPort) return false;

    await this.stop();
    await this.listen(client.routerPort);

    return true;
  }

  get listening(): number | null {
    return this.server ? this.port : null;
  }

  private async listen(port: number): Promise<void> {
    const server = createServer((req, res) => void this.handle(req, res));

    server.keepAliveTimeout = 5_000;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => resolve());
    });
    this.server = server;
    this.port = (server.address() as AddressInfo).port;
    this.requestedPort = port;
    this.logger.log(`Registry router listening on 127.0.0.1:${this.port}`);
  }

  private async stop(): Promise<boolean> {
    if (!this.server) return false;

    const server = this.server;

    this.server = null;
    await new Promise<void>((resolve) => server.close(() => resolve()));

    return true;
  }

  onModuleDestroy(): Promise<boolean> {
    return this.stop();
  }

  private async token(repository: string): Promise<string> {
    const cached = this.tokens.get(repository);

    if (cached && cached.expiresAt - TOKEN_MARGIN_MS > Date.now()) return cached.token;

    if (!this.tokenProvider) throw new Error('no connection to the control plane');

    const issued = await this.tokenProvider([repository]);

    this.tokens.set(repository, { token: issued.token, expiresAt: Date.now() + issued.expiresInSeconds * 1000 });

    return issued.token;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const client = this.client;
    const path = (req.url ?? '').split('?')[0];

    if (!client) return registryError(res, 503, 'UNAVAILABLE', 'registry router is not configured');

    if (req.method !== 'GET' && req.method !== 'HEAD')
      return registryError(res, 405, 'UNSUPPORTED', 'the node router only pulls');

    if (path === '/v2/' || path === '/v2') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Docker-Distribution-API-Version': 'registry/2.0' });

      return void res.end('{}');
    }

    const target = routeRequest(path, client);

    if (!target) return registryError(res, 404, 'NAME_UNKNOWN', 'not served by the built-in registry');

    const headers: Record<string, string> = {};

    for (const name of FORWARDED_REQUEST_HEADERS) {
      const value = req.headers[name];

      if (typeof value === 'string') headers[name] = value;
    }

    if (target.private) {
      if (!this.allowed.has(target.repository))
        return registryError(res, 403, 'DENIED', 'no workload on this node uses this repository');

      try {
        headers['authorization'] = `Bearer ${await this.token(target.repository)}`;
      } catch (error) {
        this.logger.warn(
          `No pull token for ${target.repository}: ${error instanceof Error ? error.message : String(error)}`,
        );

        return registryError(res, 503, 'UNAVAILABLE', 'no pull token');
      }
    }

    await this.forward(req.method, target, headers, res, client.endpoints);
  }

  /** Tries the members in turn, starting with the last one that answered. */
  private async forward(
    method: string,
    target: RouteTarget,
    headers: Record<string, string>,
    res: ServerResponse,
    endpoints: string[],
  ): Promise<void> {
    for (let attempt = 0; attempt < endpoints.length; attempt++) {
      const index = (this.preferred + attempt) % endpoints.length;
      const host = endpoints[index];
      const upstream = await new Promise<IncomingMessage | null>((resolve) => {
        const outgoing = request(
          { host, port: target.port, method, path: target.path, headers, timeout: CONNECT_TIMEOUT_MS },
          resolve,
        );

        outgoing.on('timeout', () => outgoing.destroy(new Error('timeout')));
        // The short timeout covers connecting only; a registry may take long before it answers (large uploads).
        outgoing.on('socket', (socket) => socket.once('connect', () => outgoing.setTimeout(IDLE_TIMEOUT_MS)));
        outgoing.on('error', () => resolve(null));
        outgoing.end();
      });

      if (!upstream || (RETRYABLE_STATUS.has(upstream.statusCode ?? 0) && attempt < endpoints.length - 1)) {
        upstream?.resume();
        continue;
      }

      this.preferred = index;
      upstream.socket.setTimeout(IDLE_TIMEOUT_MS, () => upstream.destroy());

      const responseHeaders: Record<string, string | string[]> = {};

      for (const [name, value] of Object.entries(upstream.headers)) {
        if (value !== undefined && !HOP_BY_HOP.has(name)) responseHeaders[name] = value;
      }

      res.writeHead(upstream.statusCode ?? 502, responseHeaders);
      upstream.pipe(res);
      upstream.on('error', () => res.destroy());

      return;
    }

    registryError(res, 503, 'UNAVAILABLE', 'no registry member reachable');
  }
}
