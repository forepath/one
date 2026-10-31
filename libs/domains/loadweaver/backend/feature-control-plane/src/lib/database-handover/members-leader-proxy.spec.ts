import { EventEmitter } from 'node:events';

import { databaseTarget } from './database-target.runtime';
import {
  LEADER_MISSING_CONNECT_TIMEOUT_MS,
  MembersLeaderProxy,
  PROXY_CONNECT_TIMEOUT_MS,
} from './members-leader-proxy';

/** Upstream sockets the proxy opened (the members' Postgres), never really connected. */
const mockUpstreams: MockSocket[] = [];

class MockSocket extends EventEmitter {
  destroyed = false;
  pipe = jest.fn((target: unknown) => target);
  destroy = jest.fn(() => {
    this.destroyed = true;
  });
}

jest.mock('node:net', () => ({
  ...jest.requireActual('node:net'),
  connect: jest.fn(() => {
    const socket = new MockSocket();

    mockUpstreams.push(socket);

    return socket;
  }),
}));

type Internals = {
  connections: Set<{ destroy: () => void }>;
  handle(client: MockSocket): void;
};

afterEach(() => {
  databaseTarget.reset();
  mockUpstreams.length = 0;
  jest.useRealTimers();
});

/** A proxy whose leader `10.93.0.1` answered once and then disappeared for two polls (`leaderMissing`). */
async function proxyWithMissingLeader(reachable: boolean) {
  let primary: string | null = '10.93.0.1';
  const probe = jest.fn(async () => reachable);
  const proxy = new MembersLeaderProxy(
    ['10.93.0.1'],
    0,
    async () => (primary ? [primary] : []),
    () => 0,
    probe,
  );
  const internals = proxy as unknown as Internals;

  await proxy.poll();

  const connection = { destroy: jest.fn() };

  internals.connections.add(connection);
  primary = null;
  await proxy.poll();
  await proxy.poll();
  await proxy.pendingCut;

  return { proxy, internals, connection, probe };
}

describe('MembersLeaderProxy fails fast while no primary answers (3.43 live test: writes hung ≈ 40 s)', () => {
  it("cuts the kept leader's connections once its Postgres doesn't take TCP connections either", async () => {
    const { connection, probe } = await proxyWithMissingLeader(false);

    expect(databaseTarget.leaderMissing).toBe(true);
    expect(probe).toHaveBeenCalledWith('10.93.0.1');
    expect(connection.destroy).toHaveBeenCalledTimes(1);
  });

  it('keeps the connections of a leader whose Patroni was only slow', async () => {
    const { connection, probe } = await proxyWithMissingLeader(true);

    expect(probe).toHaveBeenCalledTimes(1);
    expect(connection.destroy).not.toHaveBeenCalled();
  });

  it('probes once per outage, not on every poll', async () => {
    const { proxy, probe } = await proxyWithMissingLeader(true);

    await proxy.poll();
    await proxy.poll();
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('gives a new connection a short upstream connect timeout while leaderMissing', async () => {
    const { internals } = await proxyWithMissingLeader(true);

    jest.useFakeTimers();

    const client = new MockSocket();

    internals.handle(client);
    expect(mockUpstreams).toHaveLength(1);
    jest.advanceTimersByTime(LEADER_MISSING_CONNECT_TIMEOUT_MS - 1);
    expect(client.destroyed).toBe(false);
    jest.advanceTimersByTime(1);
    expect(client.destroyed).toBe(true);
    expect(mockUpstreams[0].destroyed).toBe(true);
  });

  it('uses the normal connect timeout with a leader, and none once connected', async () => {
    const proxy = new MembersLeaderProxy(
      ['10.93.0.1'],
      0,
      async () => ['10.93.0.1'],
      () => 0,
      async () => true,
    );
    const internals = proxy as unknown as Internals;

    await proxy.poll();
    jest.useFakeTimers();

    const slow = new MockSocket();

    internals.handle(slow);
    jest.advanceTimersByTime(LEADER_MISSING_CONNECT_TIMEOUT_MS);
    expect(slow.destroyed).toBe(false);
    jest.advanceTimersByTime(PROXY_CONNECT_TIMEOUT_MS - LEADER_MISSING_CONNECT_TIMEOUT_MS);
    expect(slow.destroyed).toBe(true);

    const fast = new MockSocket();

    internals.handle(fast);
    mockUpstreams[1].emit('connect');
    jest.advanceTimersByTime(PROXY_CONNECT_TIMEOUT_MS * 2);
    expect(fast.destroyed).toBe(false);
  });
});
