import { createSocket, type RemoteInfo, type Socket } from 'node:dgram';
import { readFile } from 'node:fs/promises';
import { isIP } from 'node:net';

import type { NodeNetworkConfig } from '@forepath/loadweaver/shared/util-agent-protocol';
import { cidrContainsIp, mustParseCidr, parseIp, type Cidr } from '@forepath/loadweaver/shared/util-network';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';

import { buildResponse, parseQuery, RCODE_REFUSED, RCODE_SERVFAIL } from './dns-message';
import { decide } from './policy-dns';

const UPSTREAM_TIMEOUT_MS = 2_000;
const MAX_QUERIES_PER_SECOND = 200;
const MAX_IN_FLIGHT_FORWARDS = 512;

export interface ResolverBinding {
  /** Addresses to listen on (the workload network gateway). */
  listen: string[];
  /** Only clients inside these prefixes are served: the resolver is never an open resolver. */
  clients: string[];
  upstreams: string[];
}

/** Nameservers from resolv.conf, skipping our own listen addresses. */
export function parseResolvConf(text: string, exclude: readonly string[] = []): string[] {
  return text
    .split('\n')
    .map((line) => /^\s*nameserver\s+(\S+)/.exec(line)?.[1])
    .filter((ns): ns is string => !!ns && isIP(ns) !== 0 && !exclude.includes(ns));
}

/**
 * Node-local, policy-aware resolver for cluster names (3.4). Every node runs one; workloads use it as their DNS.
 */
@Injectable()
export class DnsResolverService implements OnModuleDestroy {
  private readonly logger = new Logger(DnsResolverService.name);
  private sockets: Socket[] = [];
  private config: NodeNetworkConfig['dns'] = { domain: 'lw', records: [], visibility: {} };
  private clients: Cidr[] = [];
  private upstreams: string[] = [];
  private bindingKey = '';
  private readonly buckets = new Map<string, { second: number; count: number }>();
  private inFlight = 0;

  onModuleDestroy(): void {
    this.close();
  }

  update(dns: NodeNetworkConfig['dns']): void {
    this.config = dns;
  }

  /** (Re)binds when the listen addresses change; config updates alone never rebind. */
  async bind(binding: ResolverBinding): Promise<void> {
    const upstreams =
      binding.upstreams.length > 0
        ? binding.upstreams
        : parseResolvConf(await readFile('/etc/resolv.conf', 'utf8').catch(() => ''), binding.listen);

    this.clients = binding.clients.map((c) => mustParseCidr(c, false));
    this.upstreams = upstreams;

    const key = [...binding.listen].sort().join(',');

    if (key === this.bindingKey) return;

    this.close();

    for (const address of binding.listen) {
      const socket = createSocket({ type: isIP(address) === 6 ? 'udp6' : 'udp4', reuseAddr: true });

      socket.on('message', (msg, rinfo) => void this.handle(socket, msg, rinfo));
      socket.on('error', (error) => this.logger.warn(`DNS socket ${address}: ${error.message}`));
      await new Promise<void>((resolve, reject) => {
        socket.once('error', reject);
        socket.bind(53, address, () => {
          socket.off('error', reject);
          resolve();
        });
      });
      this.sockets.push(socket);
    }

    this.bindingKey = key;
  }

  close(): void {
    this.sockets.forEach((s) => s.close());
    this.sockets = [];
    this.bindingKey = '';
  }

  private allowed(client: string): boolean {
    const ip = parseIp(client);

    if (!ip || !this.clients.some((c) => cidrContainsIp(c, ip))) return false;

    const second = Math.floor(Date.now() / 1000);
    const bucket = this.buckets.get(client);

    if (!bucket || bucket.second !== second) {
      this.buckets.set(client, { second, count: 1 });

      if (this.buckets.size > 10_000) this.buckets.clear();

      return true;
    }

    return ++bucket.count <= MAX_QUERIES_PER_SECOND;
  }

  /** Handles one datagram; exposed for tests. */
  async handle(socket: Pick<Socket, 'send'>, msg: Buffer, rinfo: Pick<RemoteInfo, 'address' | 'port'>): Promise<void> {
    if (!this.allowed(rinfo.address)) return;

    const query = parseQuery(msg);

    if (!query) return;

    const decision = decide(this.config, rinfo.address, query);

    if (decision.kind === 'answer') {
      socket.send(buildResponse(query, decision.rcode, decision.addresses), rinfo.port, rinfo.address);

      return;
    }

    if (this.upstreams.length === 0 || this.inFlight >= MAX_IN_FLIGHT_FORWARDS) {
      socket.send(
        buildResponse(query, this.upstreams.length === 0 ? RCODE_REFUSED : RCODE_SERVFAIL),
        rinfo.port,
        rinfo.address,
      );

      return;
    }

    const answer = await this.forward(msg, query.id);

    socket.send(answer ?? buildResponse(query, RCODE_SERVFAIL), rinfo.port, rinfo.address);
  }

  /** Forwards over a fresh socket (random source port) and accepts only the matching upstream reply. */
  private async forward(msg: Buffer, id: number): Promise<Buffer | null> {
    const upstream = this.upstreams[0];
    const socket = createSocket(isIP(upstream) === 6 ? 'udp6' : 'udp4');

    this.inFlight++;

    try {
      return await new Promise<Buffer | null>((resolve) => {
        const timer = setTimeout(() => resolve(null), UPSTREAM_TIMEOUT_MS);

        socket.on('message', (reply, from) => {
          if (from.address !== upstream || from.port !== 53 || reply.length < 12 || reply.readUInt16BE(0) !== id)
            return;

          clearTimeout(timer);
          resolve(reply);
        });
        socket.on('error', () => {
          clearTimeout(timer);
          resolve(null);
        });
        socket.send(msg, 53, upstream);
      });
    } finally {
      this.inFlight--;
      socket.close();
    }
  }
}
