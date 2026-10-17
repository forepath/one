import { request, type IncomingMessage, type ServerResponse } from 'node:http';
import type { TLSSocket } from 'node:tls';

import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Not } from 'typeorm';

import { NodeEntity } from '../entities/node.entity';
import { REGISTRY_PRIVATE_PORT } from '../object-store/registry-state.utils';
import { nodeAddress } from '../services/object-store-controller.service';

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'host',
]);
const UPSTREAM_CACHE_MS = 15_000;
const CONNECT_TIMEOUT_MS = 5_000;
const IDLE_TIMEOUT_MS = 120_000;
const PATH = /^\/v2(\/[A-Za-z0-9_.:@/-]*)?$/;

/**
 * `docker push` / `pull` against the control-plane API (3.22): `/v2/*` is streamed to the private registry instance
 * of a control-plane member over the overlay. The registry itself checks the token, so this proxy adds no
 * authority of its own; it only picks a reachable member.
 */
@Injectable()
export class RegistryProxyService {
  private readonly logger = new Logger(RegistryProxyService.name);
  private upstreams: { at: number; hosts: string[] } | null = null;
  /** Last member that answered; requests with a body go there first (they can't be retried). */
  private preferred: string | null = null;

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  protected async members(): Promise<string[]> {
    if (this.upstreams && Date.now() - this.upstreams.at < UPSTREAM_CACHE_MS) return this.upstreams.hosts;

    const nodes = await this.dataSource
      .getRepository(NodeEntity)
      .find({ where: { controlPlane: true, lifecycle: Not('left') }, order: { name: 'ASC' } });
    const hosts = nodes.map((n) => nodeAddress(n)).filter((a): a is string => !!a);

    this.upstreams = { at: Date.now(), hosts };

    return hosts;
  }

  protected port(): number {
    return REGISTRY_PRIVATE_PORT;
  }

  /** Handler for `/v2` (Express middleware signature, works on plain Node requests too). */
  handler(): (req: IncomingMessage & { originalUrl?: string }, res: ServerResponse) => void {
    return (req, res) => void this.forward(req, res);
  }

  private async forward(req: IncomingMessage & { originalUrl?: string }, res: ServerResponse): Promise<void> {
    const path = req.originalUrl ?? req.url ?? '';

    if (!PATH.test(path.split('?')[0]) || path.includes('..')) return error(res, 404, 'NAME_UNKNOWN', 'unknown path');

    const members = await this.members().catch(() => [] as string[]);
    const hosts =
      this.preferred && members.includes(this.preferred)
        ? [this.preferred, ...members.filter((h) => h !== this.preferred)]
        : members;
    const headers: Record<string, string | string[]> = {};

    for (const [name, value] of Object.entries(req.headers)) {
      if (value !== undefined && !HOP_BY_HOP.has(name)) headers[name] = value;
    }

    headers['x-forwarded-proto'] = (req.socket as TLSSocket).encrypted ? 'https' : 'http';
    headers['x-forwarded-host'] = req.headers.host ?? '';
    // Only requests without a body can be retried on another member.
    const retryable = req.method === 'GET' || req.method === 'HEAD';

    for (const [i, host] of hosts.entries()) {
      const upstream = await new Promise<IncomingMessage | null>((resolve) => {
        const outgoing = request(
          {
            host: host.replace(/^\[|\]$/g, ''),
            port: this.port(),
            method: req.method,
            path,
            headers,
            timeout: CONNECT_TIMEOUT_MS,
          },
          resolve,
        );

        outgoing.on('timeout', () => outgoing.destroy(new Error('timeout')));
        // The short timeout covers connecting only; a registry may take long before it answers (large uploads).
        outgoing.on('socket', (socket) => socket.once('connect', () => outgoing.setTimeout(IDLE_TIMEOUT_MS)));
        outgoing.on('error', () => resolve(null));

        if (retryable) outgoing.end();
        else req.pipe(outgoing);
      });

      if (!upstream) {
        if (retryable && i < hosts.length - 1) continue;

        break;
      }

      this.preferred = host;
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

    this.logger.warn('No control-plane member registry reachable');
    error(res, 503, 'UNAVAILABLE', 'the built-in registry is not reachable');
  }
}

function error(res: ServerResponse, status: number, code: string, message: string): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ errors: [{ code, message }] }));
}
