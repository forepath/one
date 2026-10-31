import { readFile, rm, writeFile } from 'node:fs/promises';
import { connect, createServer, type Server, type Socket } from 'node:net';
import { join } from 'node:path';

import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, Optional } from '@nestjs/common';

import { AgentStateStore } from '../state/agent-state.store';

import { LEADER_PROXY_PORT, PATRONI_PORT, POSTGRES_PORT, urlHost } from './control-plane-containers';

const POLL_INTERVAL_MS = 2_000;
/** Polls in a row without any primary before the proxy logs it (once per outage). */
export const LEADER_UNKNOWN_AFTER_POLLS = 5;

/**
 * The proxy's next target from one poll: only a different primary replaces the current one (failover: connections to
 * the old one are dropped). No answer never drops it: a single slow Patroni answer used to drop every open database
 * connection of the API (G5), and after `LEADER_UNKNOWN_AFTER_POLLS` misses the leader went "unknown" and came back
 * on the next answer, cutting the connections each time (live 3.43). A primary that is really gone fails its new
 * connections either way, and a failover shows as a different primary (the control plane's proxy follows the same rule).
 * `missing`: no primary for `LEADER_UNKNOWN_AFTER_POLLS` polls (logged once).
 */
export function nextLeader(
  current: string | null,
  found: string | null,
  misses: number,
): { leader: string | null; misses: number; dropConnections: boolean; missing: boolean } {
  if (found !== null)
    return { leader: found, misses: 0, dropConnections: current !== null && found !== current, missing: false };

  return {
    leader: current,
    misses: misses + 1,
    dropConnections: false,
    missing: misses + 1 === LEADER_UNKNOWN_AFTER_POLLS,
  };
}

/**
 * The member whose Postgres takes writes now: Patroni answers `GET /primary` with 200 only while it runs as the primary
 * holding the leader lock (`GET /leader`: the lock alone). Patroni may still report a re-created primary while
 * Postgres finishes its recovery (G5: read-only for ~70 s after the bootstrap's first apply) — the API copes with
 * that (non-fatal LISTEN, listener connections released on failure).
 */
export async function findLeader(
  addresses: readonly string[],
  timeoutMs = 1_500,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const results = await Promise.all(
    addresses.map(async (address) => {
      try {
        const res = await fetchImpl(`http://${urlHost(address)}:${PATRONI_PORT}/primary`, {
          signal: AbortSignal.timeout(timeoutMs),
        });

        return res.status === 200 ? address : null;
      } catch {
        return null;
      }
    }),
  );

  return results.find((r) => r !== null) ?? null;
}

/**
 * Local TCP proxy on 127.0.0.1 to the current Postgres leader, so the control-plane API always writes to the
 * primary across Patroni failovers. Existing connections to a demoted leader are closed on a leader change.
 */
@Injectable()
export class PostgresLeaderProxy implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PostgresLeaderProxy.name);
  private server: Server | null = null;
  private timer: NodeJS.Timeout | null = null;
  private members: string[] = [];
  private leader: string | null = null;
  private misses = 0;
  private readonly connections = new Set<Socket>();

  constructor(@Optional() private readonly state?: AgentStateStore) {}

  /** The members last proxied to: kept so a restarted agent serves the API before its first desired state. */
  private get file(): string | null {
    return this.state ? join(this.state.dir, 'leader-proxy.json') : null;
  }

  /**
   * The local API needs the proxy to reach its database before the control plane can send this node anything (right
   * after `bootstrap`, after an agent restart): start with the members of the last role.
   */
  async onApplicationBootstrap(): Promise<void> {
    const file = this.file;
    const members = file
      ? ((await readFile(file, 'utf8')
          .then((raw) => JSON.parse(raw) as unknown)
          .catch(() => null)) as string[] | null)
      : null;

    if (Array.isArray(members) && members.length && members.every((m) => typeof m === 'string'))
      await this.ensure(members).catch((error: unknown) =>
        this.logger.warn(
          `Postgres leader proxy not started: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
  }

  onModuleDestroy(): void {
    this.stop();
  }

  async ensure(members: string[]): Promise<void> {
    if (this.file && members.join(',') !== this.members.join(','))
      await writeFile(this.file, JSON.stringify(members), { mode: 0o600 }).catch(() => undefined);

    this.members = members;

    if (this.server) return;

    const server = createServer((client) => this.handle(client));

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(LEADER_PROXY_PORT, '127.0.0.1', () => resolve());
    });
    this.server = server;
    await this.poll();
    this.timer = setInterval(() => void this.poll(), POLL_INTERVAL_MS);
  }

  /** `forget`: this node is no member any more (not just shutting down). */
  stop(forget = false): void {
    if (forget && this.file) void rm(this.file, { force: true });

    if (this.timer) clearInterval(this.timer);

    this.timer = null;
    this.connections.forEach((c) => c.destroy());
    this.server?.close();
    this.server = null;
  }

  private async poll(): Promise<void> {
    const next = nextLeader(this.leader, await findLeader(this.members), this.misses);

    this.misses = next.misses;

    if (next.leader !== this.leader) {
      this.logger.log(`Postgres leader is now ${next.leader ?? 'unknown'}`);
      this.leader = next.leader;
    }

    if (next.missing)
      this.logger.warn(
        `No Postgres primary answers${this.leader ? `; connections keep going to ${this.leader}` : ''} until one does`,
      );

    if (next.dropConnections) this.connections.forEach((c) => c.destroy());
  }

  private handle(client: Socket): void {
    if (!this.leader) {
      client.destroy();

      return;
    }

    const upstream = connect({ host: this.leader, port: POSTGRES_PORT });

    this.connections.add(client);
    client.pipe(upstream).pipe(client);

    const close = () => {
      this.connections.delete(client);
      client.destroy();
      upstream.destroy();
    };

    client.on('error', close);
    upstream.on('error', close);
    client.on('close', close);
    upstream.on('close', close);
  }
}
