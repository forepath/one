import { decodeControlPlaneMessage, type Envelope } from '@forepath/loadweaver/shared/util-agent-protocol';

import type { AgentSessionRegistry } from '../agent-stream/agent-session.registry';
import { LiveBroker } from './live-broker';
import { ReorderBuffer, relayKey, signRelay, verifyRelay } from './relay.utils';

type Notify = (payload: string) => Promise<void>;

/** Two replicas on one fake database: NOTIFY reaches every listener, in an order the test controls. */
function cluster() {
  const listeners: Notify[] = [];
  const relay = new Map<string, string>();
  const queue: string[] = [];
  let owner = '';
  const dataSource = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.startsWith('SELECT stream_owner')) return [{ stream_owner: owner }];

      if (sql.startsWith('SELECT pg_notify')) return void queue.push(params[1] as string);

      if (sql.startsWith('INSERT INTO lw_live_relay')) {
        const id = String(relay.size + 1);

        relay.set(id, params[0] as string);

        return [{ id }];
      }

      if (sql.startsWith('DELETE FROM lw_live_relay WHERE id')) {
        const body = relay.get(params[0] as string);

        relay.delete(params[0] as string);

        // As TypeORM's Postgres driver answers DELETE / UPDATE: [rows, affected] (G5: the broker read the pair as rows).
        return body ? [[{ body }], 1] : [[], 0];
      }

      return [];
    }),
  };
  const sent: Envelope[] = [];
  const link = { connected: true };
  const nodeRegistry = {
    get: (node: string) => (node === 'n1' && link.connected ? { send: (e: Envelope) => sent.push(e) } : undefined),
  };
  const emptyRegistry = { get: () => undefined };
  const origin = new LiveBroker(dataSource as never, emptyRegistry as unknown as AgentSessionRegistry);
  const holder = new LiveBroker(dataSource as never, nodeRegistry as unknown as AgentSessionRegistry);

  owner = holder.replica;

  for (const b of [origin, holder]) listeners.push((p) => (b as unknown as { onNotify: Notify }).onNotify(p));

  /** Delivers queued notifications (optionally in reverse order) to every replica. */
  const flush = async (reverse = false) => {
    const batch = queue.splice(0);

    for (const p of reverse ? batch.reverse() : batch) for (const l of listeners) await l(p);
  };

  return {
    origin,
    holder,
    sent,
    flush,
    queue,
    link,
    dataSource,
    setOwner: (o: string) => (owner = o),
  };
}

describe('live relay', () => {
  const env = process.env.ENCRYPTION_KEY;

  beforeAll(() => (process.env.ENCRYPTION_KEY = 'test-key'));
  afterAll(() => (process.env.ENCRYPTION_KEY = env));

  it('signs and verifies relay messages', () => {
    const key = relayKey('k') as Buffer;
    const signed = signRelay(key, '{"a":1}');

    expect(verifyRelay(key, signed)).toBe('{"a":1}');
    expect(verifyRelay(key, signed.replace('{"a":1}', '{"a":2}'))).toBeNull();
    expect(verifyRelay(relayKey('other') as Buffer, signed)).toBeNull();
    expect(verifyRelay(key, '{"a":1}')).toBeNull();
    expect(relayKey(undefined)).toBeNull();
  });

  it('reorders and gives up on runaway channels', () => {
    const buffer = new ReorderBuffer<string>();

    expect(buffer.push(1, 'b')).toEqual([]);
    expect(buffer.waiting).toBe(true);
    expect(buffer.push(0, 'a')).toEqual(['a', 'b']);
    expect(buffer.push(0, 'a')).toEqual([]);

    for (let i = 3; i < 1_003; i++) expect(buffer.push(i, 'x')).toEqual([]);

    expect(buffer.push(1_003, 'x')).toBeNull();
  });

  it('relays a session to the replica holding the node, in order, and its replies back', async () => {
    const { origin, holder, sent, flush } = cluster();
    const received: string[] = [];
    const channel = origin.openChannel((type, payload) => received.push(`${type}:${payload['data'] ?? ''}`));

    await origin.send('n1', channel, 'execOpen', {
      target: { kind: 'replica', replica: 'shop/site/web/0' },
      command: ['sh'],
      cols: 80,
      rows: 24,
    });
    // A large message travels through the table, small ones inline: delivered out of order, still applied in order.
    await origin.send('n1', channel, 'execInput', { data: Buffer.from('x'.repeat(8_000)).toString('base64') });
    await origin.send('n1', channel, 'execInput', { data: Buffer.from('y').toString('base64') });
    await flush(true);

    expect(sent.map((e) => decodeControlPlaneMessage(e))).toMatchObject([
      { ok: true, message: { type: 'execOpen' } },
      { ok: true, message: { type: 'execInput' } },
      { ok: true, message: { type: 'execInput', payload: { data: Buffer.from('y').toString('base64') } } },
    ]);

    holder.fromAgent('n1', { channel } as Envelope, 'execOutput', { data: 'aGk=' });
    // Another node can't answer on this channel.
    holder.fromAgent('n2', { channel } as Envelope, 'execOutput', { data: 'ZXZpbA==' });
    holder.fromAgent('n1', { channel } as Envelope, 'execExit', { code: 0 });
    await flush(true);

    expect(received).toEqual(['execOutput:aGk=', 'execExit:']);
  });

  it('drops forged notifications and non-live message types', async () => {
    const { holder, sent, queue, flush } = cluster();
    const forged = JSON.stringify({
      to: holder.replica,
      from: 'x',
      node: 'n1',
      channel: 'c',
      seq: 0,
      type: 'execOpen',
      payload: { target: { kind: 'node' }, command: ['sh'], cols: 80, rows: 24 },
    });

    queue.push(forged, `${'0'.repeat(64)}.${forged}`);
    queue.push(signRelay(relayKey('test-key') as Buffer, forged.replace('execOpen', 'desiredState')));
    await flush();

    expect(sent).toEqual([]);
  });

  it("ends a node's live sessions when its stream here drops: local ones and relayed ones (G5)", async () => {
    const { origin, holder, flush, link, dataSource } = cluster();
    const local: string[] = [];
    const remote: string[] = [];
    const localChannel = holder.openChannel((type, payload) => local.push(`${type}:${String(payload['error'])}`));
    const remoteChannel = origin.openChannel((type, payload) => remote.push(`${type}:${String(payload['reason'])}`));

    await holder.send('n1', localChannel, 'consoleOpen', {
      target: { kind: 'replica', replica: 'shop/site/vm/0' },
      kind: 'serial',
      cols: 80,
      rows: 24,
    });
    await origin.send('n1', remoteChannel, 'tunnelOpen', { replica: 'shop/site/web/0', port: 80 });
    await flush();

    link.connected = false;
    await holder.released('n1');
    await flush();

    expect(local).toEqual(['execExit:node disconnected']);
    expect(remote).toEqual(['tunnelClose:node disconnected']);
    expect(dataSource.query).toHaveBeenCalledWith(expect.stringContaining('SET stream_owner = NULL'), [
      'n1',
      holder.replica,
    ]);

    // The channels are gone: later messages of the node on them reach nobody.
    holder.fromAgent('n1', { channel: localChannel } as Envelope, 'execOutput', { data: 'aGk=' });
    holder.fromAgent('n1', { channel: remoteChannel } as Envelope, 'tunnelData', { data: 'aGk=' });
    await flush();

    expect(local).toHaveLength(1);
    expect(remote).toHaveLength(1);
  });

  it('keeps the sessions when the stream moved on (newer stream here, or another replica owns the node)', async () => {
    const { holder, link, setOwner, dataSource } = cluster();
    const ended: string[] = [];
    const channel = holder.openChannel((type) => ended.push(type));

    await holder.send('n1', channel, 'execOpen', { target: { kind: 'node' }, command: ['sh'], cols: 80, rows: 24 });

    // A newer stream of the node is registered here: the old one's close changes nothing (not even the owner).
    dataSource.query.mockClear();
    await holder.released('n1');
    expect(ended).toEqual([]);
    expect(dataSource.query).not.toHaveBeenCalled();

    // The make-before-break switch went to another replica: the agent keeps its sessions.
    link.connected = false;
    setOwner('another-replica');
    await holder.released('n1');
    expect(ended).toEqual([]);

    // A database that can't answer doesn't keep them open.
    dataSource.query.mockRejectedValueOnce(new Error('connection lost'));
    await holder.released('n1');
    expect(ended).toEqual(['execExit']);
  });

  it('keeps a channel bound to its node', async () => {
    const { origin } = cluster();
    const channel = origin.openChannel(() => undefined);

    await origin.send('n1', channel, 'tunnelOpen', { replica: 'shop/site/web/0', port: 80 }).catch(() => undefined);
    await expect(origin.send('n2', channel, 'tunnelClose', {})).rejects.toThrow('another node');
    await expect(origin.send('n1', channel, 'desiredState' as never, {})).rejects.toThrow('not a live message');
  });

  it('does not fail the bootstrap while the database refuses LISTEN (recovery), and listens once it accepts (G5)', async () => {
    jest.useFakeTimers();

    try {
      let refuse = true;
      const listened: string[] = [];
      const runner = () => ({
        connect: async () => undefined,
        query: async (sql: string) => {
          if (refuse) throw new Error('cannot execute LISTEN during recovery');

          listened.push(sql);
        },
        release: async () => undefined,
        databaseConnection: { on: () => undefined },
      });
      const broker = new LiveBroker(
        { createQueryRunner: runner, query: async () => [] } as never,
        { get: () => undefined } as unknown as AgentSessionRegistry,
      );

      await expect(broker.onApplicationBootstrap()).resolves.toBeUndefined();
      expect(listened).toEqual([]);
      refuse = false;
      await jest.advanceTimersByTimeAsync(10_000);
      expect(listened).toEqual(['LISTEN lw_live']);
      await broker.onModuleDestroy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('reconnects LISTEN with a back-off and logs the loss and the recovery once (3.43 live test)', async () => {
    jest.useFakeTimers();

    try {
      let refuse = true;
      let attempts = 0;
      const runner = () => ({
        connect: async () => {
          attempts++;

          if (refuse) throw new Error('Connection terminated unexpectedly');
        },
        query: async () => undefined,
        release: async () => undefined,
        databaseConnection: { on: () => undefined },
      });
      const broker = new LiveBroker(
        { createQueryRunner: runner, query: async () => [] } as never,
        { get: () => undefined } as unknown as AgentSessionRegistry,
      );
      const log = { log: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() };

      Object.assign(broker, { logger: log });
      (broker as unknown as { listenBackoff: { logger: unknown } }).listenBackoff.logger = log;

      await broker.onApplicationBootstrap();
      // 45 s without a leader: attempts at 0, 2, 6, 14, 30 s (no longer every 2 s).
      await jest.advanceTimersByTimeAsync(45_000);
      expect(attempts).toBe(5);
      expect(log.warn).toHaveBeenCalledTimes(1);
      expect(log.warn.mock.calls[0][0]).toContain('Relay LISTEN lost: Connection terminated unexpectedly');

      refuse = false;
      await jest.advanceTimersByTimeAsync(30_000);
      expect(attempts).toBe(6);
      expect(log.warn).toHaveBeenCalledTimes(1);
      expect(log.log).toHaveBeenCalledWith('Relay LISTEN restored after 5 failed attempt(s)');
      await broker.onModuleDestroy();
    } finally {
      jest.useRealTimers();
    }
  });
});
