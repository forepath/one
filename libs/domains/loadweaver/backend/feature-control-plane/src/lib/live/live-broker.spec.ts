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

        return body ? [{ body }] : [];
      }

      return [];
    }),
  };
  const sent: Envelope[] = [];
  const nodeRegistry = { get: (node: string) => (node === 'n1' ? { send: (e: Envelope) => sent.push(e) } : undefined) };
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

  return { origin, holder, sent, flush, queue };
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

  it('keeps a channel bound to its node', async () => {
    const { origin } = cluster();
    const channel = origin.openChannel(() => undefined);

    await origin.send('n1', channel, 'tunnelOpen', { replica: 'shop/site/web/0', port: 80 }).catch(() => undefined);
    await expect(origin.send('n2', channel, 'tunnelClose', {})).rejects.toThrow('another node');
    await expect(origin.send('n1', channel, 'desiredState' as never, {})).rejects.toThrow('not a live message');
  });
});
