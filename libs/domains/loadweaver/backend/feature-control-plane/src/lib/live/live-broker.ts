import { randomUUID } from 'node:crypto';

import {
  controlPlaneMessage,
  type ControlPlaneMessageType,
  type Envelope,
} from '@forepath/loadweaver/shared/util-agent-protocol';
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, type QueryRunner } from 'typeorm';

import { AgentSessionRegistry } from '../agent-stream/agent-session.registry';
import { relayKey, ReorderBuffer, signRelay, verifyRelay } from './relay.utils';

/** Messages a live session sends to the node / receives from it (3.19). */
export const LIVE_TO_AGENT = [
  'execOpen',
  'execInput',
  'execResize',
  'execClose',
  'fileRequest',
  'tunnelOpen',
  'tunnelData',
  'tunnelClose',
] as const;
export const LIVE_FROM_AGENT = ['execOutput', 'execExit', 'fileResponse', 'tunnelData', 'tunnelClose'] as const;
export type LiveToAgent = (typeof LIVE_TO_AGENT)[number];
export type LiveFromAgent = (typeof LIVE_FROM_AGENT)[number];
/** Messages that end a session's channel on the node side. */
const ENDING = new Set<string>(['execExit', 'fileResponse', 'tunnelClose']);

const NOTIFY_CHANNEL = 'lw_live';
/** `pg_notify` payloads stay below Postgres' 8000-byte limit; larger messages go through `lw_live_relay`. */
const MAX_INLINE = 7_000;
/** A relayed channel waiting this long for a missing message is given up. */
const STALL_MS = 10_000;
/** Owner-side channels without traffic for this long are forgotten (tunnels end after 8 h anyway). */
const IDLE_MS = 24 * 3_600_000;
const RECONNECT_MS = 2_000;

interface RelayMessage {
  /** Replica the message is for. */
  to: string;
  from: string;
  /** Set for messages towards a node; absent for replies to the session's origin. */
  node?: string;
  channel: string;
  /** Per channel and direction, from 0: relayed messages may overtake each other. */
  seq: number;
  type: string;
  payload: unknown;
}

type Kind = 'exec' | 'file' | 'tunnel';

const kindOf = (type: string): Kind =>
  type.startsWith('tunnel') ? 'tunnel' : type.startsWith('file') ? 'file' : 'exec';

/** The message that ends a session of this kind towards its origin, with an error. */
function ending(kind: Kind, error: string): { type: LiveFromAgent; payload: Record<string, unknown> } {
  return kind === 'file'
    ? { type: 'fileResponse', payload: { ok: false, error: { code: 'failed', message: error } } }
    : kind === 'tunnel'
      ? { type: 'tunnelClose', payload: { reason: error } }
      : { type: 'execExit', payload: { code: null, error } };
}

export type LiveHandler = (type: LiveFromAgent, payload: Record<string, unknown>) => void;

/**
 * Bridges live sessions (terminals, files, tunnels, 3.19) between the replica the browser / CLI talks to and the one
 * holding the node's stream: directly when it's this replica, otherwise through Postgres LISTEN / NOTIFY (every
 * replica shares the database; large messages through a short-lived relay table). The node's owner replica is
 * recorded on the node at hello.
 *
 * Relayed messages are signed with a key derived from the cluster's encryption key (anyone with database access can
 * NOTIFY, only replicas can sign), carry live message types only, stay bound to the node and replicas of their
 * channel, and are numbered so the receiver delivers them in order.
 */
@Injectable()
export class LiveBroker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(LiveBroker.name);
  readonly replica = randomUUID();
  private readonly key = relayKey(process.env.ENCRYPTION_KEY);
  private readonly handlers = new Map<string, LiveHandler>();
  /** Origin side: the node of each channel (and its owner replica once relayed). */
  private readonly channels = new Map<string, { node: string; kind: Kind; owner?: string }>();
  /** Owner side: channels opened by another replica, and which one. */
  private readonly relayed = new Map<string, { origin: string; node: string; kind: Kind; at: number }>();
  private readonly outSeq = new Map<string, number>();
  private readonly inbound = new Map<string, { buffer: ReorderBuffer<RelayMessage>; since: number | null }>();
  private listener: QueryRunner | null = null;
  private sweep: NodeJS.Timeout | null = null;
  private stalls: NodeJS.Timeout | null = null;
  private destroyed = false;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly registry: AgentSessionRegistry,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.key) this.logger.warn('ENCRYPTION_KEY is not set: live sessions are not relayed between replicas');

    await this.listen();
    this.sweep = setInterval(() => {
      void this.dataSource
        .query(`DELETE FROM lw_live_relay WHERE created_at < now() - INTERVAL '1 minute'`)
        .catch(() => undefined);

      for (const [channel, r] of this.relayed) if (Date.now() - r.at > IDLE_MS) this.forget(channel);
    }, 60_000);
    this.stalls = setInterval(() => {
      for (const [channel, i] of this.inbound)
        if (i.since !== null && Date.now() - i.since > STALL_MS) this.broken(channel, 'relay lost a message');
    }, STALL_MS / 2);
  }

  async onModuleDestroy(): Promise<void> {
    this.destroyed = true;

    if (this.sweep) clearInterval(this.sweep);

    if (this.stalls) clearInterval(this.stalls);

    await this.listener?.release().catch(() => undefined);
  }

  /** LISTEN on a dedicated connection; reconnects when it drops (e.g. a database failover). */
  private async listen(): Promise<void> {
    const reconnect = () => {
      if (this.destroyed || !this.listener) return;

      const old = this.listener;

      this.listener = null;
      void old.release().catch(() => undefined);
      setTimeout(
        () => void this.listen().catch((e) => (this.logger.warn(`Relay LISTEN: ${String(e)}`), reconnect())),
        RECONNECT_MS,
      );
    };
    const runner = this.dataSource.createQueryRunner();

    this.listener = runner;

    try {
      await runner.connect();
      await runner.query(`LISTEN ${NOTIFY_CHANNEL}`);
    } catch (error) {
      reconnect();

      throw error;
    }

    const client = (
      runner as unknown as {
        databaseConnection: { on(event: string, fn: (m: { payload?: string }) => void): void };
      }
    ).databaseConnection;

    client.on(
      'notification',
      (m) => void this.onNotify(m.payload ?? '').catch((e) => this.logger.warn(`Relay: ${String(e)}`)),
    );
    client.on('error', reconnect);
    client.on('end', reconnect);
  }

  /** The stream server calls this when a node's stream opens / closes here. */
  async owned(node: string): Promise<void> {
    await this.dataSource.query(`UPDATE lw_nodes SET stream_owner = $2 WHERE name = $1`, [node, this.replica]);
  }

  async released(node: string): Promise<void> {
    await this.dataSource.query(`UPDATE lw_nodes SET stream_owner = NULL WHERE name = $1 AND stream_owner = $2`, [
      node,
      this.replica,
    ]);
  }

  /** A new channel for a session; its messages from the node arrive at `handler`. */
  openChannel(handler: LiveHandler): string {
    const channel = randomUUID();

    this.handlers.set(channel, handler);

    return channel;
  }

  closeChannel(channel: string): void {
    this.handlers.delete(channel);
    this.channels.delete(channel);
    this.outSeq.delete(channel);
    this.inbound.delete(channel);
  }

  /** Sends a message of a session to the node, wherever its stream is. */
  async send(node: string, channel: string, type: LiveToAgent, payload: Record<string, unknown>): Promise<void> {
    if (!(LIVE_TO_AGENT as readonly string[]).includes(type)) throw new Error(`not a live message: ${type}`);

    const bound = this.channels.get(channel);

    if (bound && bound.node !== node) throw new Error('channel belongs to another node');

    if (!bound) this.channels.set(channel, { node, kind: kindOf(type) });

    const session = this.registry.get(node);

    if (session) {
      session.send(controlPlaneMessage(type as ControlPlaneMessageType, payload as never, { channel }));

      return;
    }

    // Numbered before any await, so concurrent sends keep their order.
    const seq = this.nextSeq(channel);
    const [row]: { stream_owner: string | null }[] = await this.dataSource.query(
      `SELECT stream_owner FROM lw_nodes WHERE name = $1`,
      [node],
    );

    if (!row?.stream_owner) throw new Error(`node ${node} is not connected`);

    const entry = this.channels.get(channel);

    if (entry) entry.owner ??= row.stream_owner;

    await this.notify({ to: row.stream_owner, from: this.replica, node, channel, seq, type, payload });
  }

  /** The stream server hands every live message from a node here (with its envelope channel). */
  fromAgent(node: string, envelope: Envelope, type: LiveFromAgent, payload: Record<string, unknown>): void {
    const channel = envelope.channel;

    if (!channel) return;

    const handler = this.handlers.get(channel);

    if (handler) {
      if (this.channels.get(channel)?.node === node) handler(type, payload);

      return;
    }

    const relayed = this.relayed.get(channel);

    if (!relayed || relayed.node !== node) return;

    relayed.at = Date.now();

    const seq = this.nextSeq(channel);

    if (ENDING.has(type)) this.forget(channel);

    void this.notify({ to: relayed.origin, from: this.replica, channel, seq, type, payload }).catch((e) =>
      this.logger.warn(`Relay to ${relayed.origin}: ${String(e)}`),
    );
  }

  private nextSeq(channel: string): number {
    const seq = this.outSeq.get(channel) ?? 0;

    this.outSeq.set(channel, seq + 1);

    return seq;
  }

  /** Owner side: a relayed channel is done. */
  private forget(channel: string): void {
    this.relayed.delete(channel);
    this.outSeq.delete(channel);
    this.inbound.delete(channel);
  }

  private async notify(message: RelayMessage): Promise<void> {
    if (!this.key) throw new Error('live sessions are not relayed between replicas without ENCRYPTION_KEY');

    const body = JSON.stringify(message);

    if (body.length <= MAX_INLINE) {
      await this.dataSource.query(`SELECT pg_notify($1, $2)`, [NOTIFY_CHANNEL, signRelay(this.key, body)]);

      return;
    }

    const [{ id }] = await this.dataSource.query(`INSERT INTO lw_live_relay (body) VALUES ($1) RETURNING id`, [
      signRelay(this.key, body),
    ]);

    await this.dataSource.query(`SELECT pg_notify($1, $2)`, [
      NOTIFY_CHANNEL,
      signRelay(this.key, JSON.stringify({ to: message.to, ref: id })),
    ]);
  }

  private async onNotify(raw: string): Promise<void> {
    if (!this.key) return;

    const verified = verifyRelay(this.key, raw);

    if (verified === null) return void this.logger.warn('Relay: dropped a message without a valid signature');

    let message = JSON.parse(verified) as RelayMessage & { ref?: string };

    if (message.to !== this.replica) return;

    if (message.ref) {
      const [row]: { body: string }[] = await this.dataSource.query(
        `DELETE FROM lw_live_relay WHERE id = $1 RETURNING body`,
        [message.ref],
      );
      const body = row ? verifyRelay(this.key, row.body) : null;

      if (body === null) return;

      message = JSON.parse(body) as RelayMessage;
    }

    const allowed: readonly string[] = message.node ? LIVE_TO_AGENT : LIVE_FROM_AGENT;

    if (!allowed.includes(message.type) || !Number.isSafeInteger(message.seq) || message.seq < 0) return;

    // Only channels this replica knows (origin) or may learn (owner, for a node streaming here) get a buffer.
    if (!message.node && !this.handlers.has(message.channel)) return;

    const inbound = this.inbound.get(message.channel) ?? { buffer: new ReorderBuffer<RelayMessage>(), since: null };

    this.inbound.set(message.channel, inbound);

    const ready = inbound.buffer.push(message.seq, message);

    if (ready === null) return void this.broken(message.channel, 'relay out of order');

    inbound.since = inbound.buffer.waiting ? (inbound.since ?? Date.now()) : null;

    for (const m of ready) this.deliver(m);
  }

  private deliver(message: RelayMessage): void {
    if (!message.node) {
      // A reply for a session opened here, from the replica holding its node's stream.
      const entry = this.channels.get(message.channel);
      const handler = this.handlers.get(message.channel);

      if (!handler || !entry || (entry.owner && entry.owner !== message.from)) return;

      handler(message.type as LiveFromAgent, message.payload as Record<string, unknown>);

      return;
    }

    // Towards a node whose stream is here; a channel stays with its node and origin.
    const existing = this.relayed.get(message.channel);

    if (existing && (existing.node !== message.node || existing.origin !== message.from)) return;

    const session = this.registry.get(message.node);

    if (!session) {
      const end = ending(kindOf(message.type), 'node not connected');
      const seq = this.nextSeq(message.channel);

      this.forget(message.channel);
      void this.notify({
        to: message.from,
        from: this.replica,
        channel: message.channel,
        seq,
        ...end,
      }).catch((e) => this.logger.warn(`Relay to ${message.from}: ${String(e)}`));

      return;
    }

    this.relayed.set(message.channel, {
      origin: message.from,
      node: message.node,
      kind: existing?.kind ?? kindOf(message.type),
      at: Date.now(),
    });
    session.send(
      controlPlaneMessage(message.type as ControlPlaneMessageType, message.payload as never, {
        channel: message.channel,
      }),
    );
  }

  /** A relayed channel lost a message: end the session on both sides. */
  private broken(channel: string, error: string): void {
    this.logger.warn(`Live channel ${channel}: ${error}`);

    const handler = this.handlers.get(channel);
    const entry = this.channels.get(channel);

    if (handler && entry) {
      const end = ending(entry.kind, error);

      if (entry.kind !== 'file')
        void this.send(entry.node, channel, entry.kind === 'tunnel' ? 'tunnelClose' : 'execClose', {}).catch(
          () => undefined,
        );

      handler(end.type, end.payload);
      this.closeChannel(channel);

      return;
    }

    const relayed = this.relayed.get(channel);

    this.forget(channel);

    if (!relayed) return;

    if (relayed.kind !== 'file')
      this.registry
        .get(relayed.node)
        ?.send(controlPlaneMessage(relayed.kind === 'tunnel' ? 'tunnelClose' : 'execClose', {} as never, { channel }));

    const end = ending(relayed.kind, error);

    void this.notify({
      to: relayed.origin,
      from: this.replica,
      channel,
      seq: this.nextSeq(channel),
      ...end,
    }).catch(() => undefined);
  }
}
