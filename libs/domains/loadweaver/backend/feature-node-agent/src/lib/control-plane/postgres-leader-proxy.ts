import { connect, createServer, type Server, type Socket } from 'node:net';

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';

import { LEADER_PROXY_PORT, PATRONI_PORT, POSTGRES_PORT, urlHost } from './control-plane-containers';

const POLL_INTERVAL_MS = 2_000;

/** Patroni answers `GET /leader` with 200 only on the current leader. */
export async function findLeader(addresses: readonly string[], timeoutMs = 1_500): Promise<string | null> {
  const results = await Promise.all(
    addresses.map(async (address) => {
      try {
        const res = await fetch(`http://${urlHost(address)}:${PATRONI_PORT}/leader`, {
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
export class PostgresLeaderProxy implements OnModuleDestroy {
  private readonly logger = new Logger(PostgresLeaderProxy.name);
  private server: Server | null = null;
  private timer: NodeJS.Timeout | null = null;
  private members: string[] = [];
  private leader: string | null = null;
  private readonly connections = new Set<Socket>();

  onModuleDestroy(): void {
    this.stop();
  }

  async ensure(members: string[]): Promise<void> {
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

  stop(): void {
    if (this.timer) clearInterval(this.timer);

    this.timer = null;
    this.connections.forEach((c) => c.destroy());
    this.server?.close();
    this.server = null;
  }

  private async poll(): Promise<void> {
    const leader = await findLeader(this.members);

    if (leader !== this.leader) {
      this.logger.log(`Postgres leader is now ${leader ?? 'unknown'}`);
      this.leader = leader;
      this.connections.forEach((c) => c.destroy());
    }
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
