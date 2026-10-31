import { connect, createServer, type Server, type Socket } from 'node:net';

import { Logger } from '@nestjs/common';

import { databaseTarget } from './database-target.runtime';
import { initialFallbackState, nextFallback, type FallbackState } from './database-handover.utils';

export const MEMBER_PATRONI_PORT = 8008;
export const MEMBER_POSTGRES_PORT = 5432;
/** Local port of the external control plane's own leader proxy (inside its container). */
export const DEFAULT_DATABASE_PROXY_PORT = 5433;
const POLL_INTERVAL_MS = 2_000;
/** Polls in a row without a primary before writes are refused (one slow answer is no outage). */
export const LEADER_MISSING_POLLS = 2;
/** Upstream connect timeout of the proxy (none before: a powered-off leader let connects hang for minutes). */
export const PROXY_CONNECT_TIMEOUT_MS = 10_000;
/** The same while no primary answers (`leaderMissing`): requests fail fast (503) instead of hanging (3.43 live test). */
export const LEADER_MISSING_CONNECT_TIMEOUT_MS = 2_000;

function urlHost(address: string): string {
  return address.includes(':') ? `[${address}]` : address;
}

/** The member whose Patroni answers `GET /primary` with 200 (the writable leader), or null. */
export async function findMembersPrimary(
  addresses: readonly string[],
  timeoutMs = 1_500,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  return (await findMembersPrimaries(addresses, timeoutMs, fetchImpl))[0] ?? null;
}

/**
 * Every member whose Patroni answers `GET /primary` with 200, in address order. More than one after a takeover (3.43):
 * a member that came back with data of an older epoch leads its old scope until its agent fences it.
 */
export async function findMembersPrimaries(
  addresses: readonly string[],
  timeoutMs = 1_500,
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  const results = await Promise.all(
    addresses.map(async (address) => {
      try {
        const res = await fetchImpl(`http://${urlHost(address)}:${MEMBER_PATRONI_PORT}/primary`, {
          signal: AbortSignal.timeout(timeoutMs),
        });

        return res.status === 200 ? address : null;
      } catch {
        return null;
      }
    }),
  );

  return results.filter((r): r is string => r !== null);
}

/** Whether a TCP connection to `host:port` opens within `timeoutMs` (the leader's Postgres, not only its Patroni). */
export function tcpReachable(host: string, port: number, timeoutMs = 1_500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const done = (ok: boolean) => {
      clearTimeout(timer);
      socket.destroy();
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), timeoutMs);

    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

/** The primary the proxy uses: the current leader while it still answers (a second primary is no failover). */
export function choosePrimary(primaries: readonly string[], current: string | null): string | null {
  if (current && primaries.includes(current)) return current;

  return primaries[0] ?? null;
}

/**
 * The external control plane's TCP proxy to the members' Postgres leader (3.43), like the agent's leader proxy on
 * members: TypeORM connects to `127.0.0.1:<port>` with TLS verified against the cluster CA (end to end, the proxy only
 * forwards bytes). Its polls also drive the read-only fallback: no primary for `FALLBACK_AFTER_MS` → new connections go
 * to the external copy (read-only sessions); a primary again → back to the members.
 */
export class MembersLeaderProxy {
  private readonly logger = new Logger('DatabaseHandover');
  private server: Server | null = null;
  private timer: NodeJS.Timeout | null = null;
  private leader: string | null = null;
  private state: FallbackState = initialFallbackState();
  private everReached = false;
  /** The last poll found a primary (logs a miss once). */
  private answered = false;
  /** Polls in a row without a primary. */
  private misses = 0;
  private readonly connections = new Set<Socket>();
  /** The last `cutIfUnreachable` (tests). */
  pendingCut: Promise<void> = Promise.resolve();

  constructor(
    private members: string[],
    private readonly port: number = DEFAULT_DATABASE_PROXY_PORT,
    private readonly find: (addresses: readonly string[]) => Promise<string[]> = findMembersPrimaries,
    private readonly now: () => number = () => Date.now(),
    /** Whether the leader's Postgres still accepts TCP connections (checked once when `leaderMissing` starts). */
    private readonly reachable: (host: string) => Promise<boolean> = (host) => tcpReachable(host, MEMBER_POSTGRES_PORT),
  ) {}

  setMembers(members: string[]): void {
    this.members = [...members];
  }

  async start(): Promise<void> {
    const server = createServer((client) => this.handle(client));

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.port, '127.0.0.1', () => resolve());
    });
    this.server = server;
    await this.poll();
    this.timer = setInterval(() => void this.poll(), POLL_INTERVAL_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);

    this.timer = null;
    this.connections.forEach((c) => c.destroy());
    this.server?.close();
    this.server = null;
  }

  /** The primary new connections go to (null: none known). */
  currentLeader(): string | null {
    return this.leader;
  }

  /** One poll (exposed for tests). */
  async poll(): Promise<void> {
    const found = choosePrimary(await this.find(this.members), this.leader);

    this.state = nextFallback(this.state, found !== null, this.now(), !this.everReached);
    databaseTarget.noPrimarySince = this.state.missingSince;

    if (found) this.everReached = true;

    if (found && found !== this.leader) {
      // A different primary (failover): connections to the old one go.
      this.connections.forEach((c) => c.destroy());
      this.logger.log(`Members' Postgres leader is now ${found}`);
      this.leader = found;
    } else if (!found && this.leader && this.answered) {
      // One poll without an answer (a slow member, live 3.43: every miss cut every connection) is no reason to drop
      // a working leader: its connections stay and new ones still go there; a failover shows as a different primary,
      // a longer outage as the fallback (which cuts the connections itself).
      this.logger.warn(`Members' Postgres leader ${this.leader} did not answer the last poll`);
    }

    this.answered = found !== null;
    this.misses = found ? 0 : this.misses + 1;

    // Writes 503 right away instead of failing (500) until the fallback starts (live 3.43: ~45 s); reads go on.
    const leaderMissing = this.misses >= LEADER_MISSING_POLLS && !this.state.fallback;

    if (leaderMissing !== databaseTarget.leaderMissing) {
      if (leaderMissing) this.logger.warn("No member's Postgres leader answers: writes are refused until one does");

      databaseTarget.leaderMissing = leaderMissing;

      if (leaderMissing && this.leader) this.pendingCut = this.cutIfUnreachable(this.leader);
    }

    if (this.state.fallback !== databaseTarget.fallback) {
      this.logger.warn(
        this.state.fallback
          ? "No member's Postgres leader is reachable: read-only from the external copy until one is back"
          : "Members' Postgres leader reachable again: back on the members' database",
      );
      databaseTarget.setFallback(this.state.fallback);
    }
  }

  /**
   * `leaderMissing` started (3.43 live test: requests hung up to the client's timeout until the fallback cut the
   * connections ≈ 40 s later). When the kept leader's Postgres doesn't take TCP connections either, its connections are
   * cut now: running queries fail at once (503 through the interceptor), LISTEN clients reconnect with their back-off.
   * A leader whose Patroni was only slow keeps its connections.
   */
  private async cutIfUnreachable(leader: string): Promise<void> {
    if (await this.reachable(leader)) return;

    if (!databaseTarget.leaderMissing || this.leader !== leader || this.connections.size === 0) return;

    this.logger.warn(
      `Members' Postgres leader ${leader} is unreachable: its ${this.connections.size} connection(s) cut`,
    );
    this.connections.forEach((c) => c.destroy());
  }

  private handle(client: Socket): void {
    if (!this.leader || databaseTarget.fallback) {
      client.destroy();

      return;
    }

    const upstream = connect({ host: this.leader, port: MEMBER_POSTGRES_PORT });
    const close = () => {
      this.connections.delete(client);
      client.destroy();
      upstream.destroy();
    };
    // Short while no primary answers: a new pool connection fails fast instead of waiting for a gone leader.
    const connectTimeout = setTimeout(
      close,
      databaseTarget.leaderMissing ? LEADER_MISSING_CONNECT_TIMEOUT_MS : PROXY_CONNECT_TIMEOUT_MS,
    );

    connectTimeout.unref?.();
    upstream.once('connect', () => clearTimeout(connectTimeout));
    upstream.once('close', () => clearTimeout(connectTimeout));
    this.connections.add(client);
    client.pipe(upstream).pipe(client);

    client.on('error', close);
    upstream.on('error', close);
    client.on('close', close);
    upstream.on('close', close);
  }
}

/** The running proxy of this process (members target only). */
export const membersProxy: { current: MembersLeaderProxy | null } = { current: null };
