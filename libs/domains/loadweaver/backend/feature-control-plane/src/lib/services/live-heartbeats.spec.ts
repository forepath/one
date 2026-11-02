import { databaseTarget } from '../database-handover/database-target.runtime';
import { NodeEntity } from '../entities/node.entity';
import {
  applyLiveHeartbeat,
  clearLiveHeartbeats,
  recordLiveDisconnect,
  recordLiveHeartbeat,
  type LiveHeartbeatTarget,
} from './live-heartbeats';
import { NodeAgentsService } from './node-agents.service';
import { nodeConnectedInCluster } from './nodes.service';

const stored = (): LiveHeartbeatTarget => ({
  name: 'n1',
  connected: true,
  lastSeenAt: new Date('2026-10-31T08:00:00Z'),
  usage: { cpuMillis: 100, memoryBytes: 1, diskBytes: 1 },
  appliedRevision: 4,
});

describe('live heartbeats during the read-only fallback (3.43)', () => {
  afterEach(() => {
    clearLiveHeartbeats();
    databaseTarget.reset();
  });

  it('overrides the frozen row with a newer live heartbeat, only during the fallback', () => {
    const at = new Date('2026-10-31T09:00:00Z');

    recordLiveHeartbeat('n1', {
      lastSeenAt: at,
      connected: true,
      usage: { cpuMillis: 900, memoryBytes: 2, diskBytes: 3 },
      appliedRevision: 7,
    });

    const writable = stored();

    applyLiveHeartbeat(writable, false);
    expect(writable.lastSeenAt?.toISOString()).toBe('2026-10-31T08:00:00.000Z');

    const live = stored();

    applyLiveHeartbeat(live, true);
    expect(live).toMatchObject({ lastSeenAt: at, connected: true, appliedRevision: 7 });
    expect(live.usage?.cpuMillis).toBe(900);
    expect(nodeConnectedInCluster({ lifecycle: 'active', connected: true, lastSeenAt: at }, at.getTime() + 5_000)).toBe(
      true,
    );
  });

  it('keeps a stored row that is as new, and other nodes untouched', () => {
    recordLiveHeartbeat('n1', { lastSeenAt: new Date('2026-10-31T07:00:00Z'), connected: false });

    const row = stored();
    const other = { ...stored(), name: 'n2' };

    applyLiveHeartbeat(row, true);
    applyLiveHeartbeat(other, true);
    expect(row.connected).toBe(true);
    expect(other.lastSeenAt?.toISOString()).toBe('2026-10-31T08:00:00.000Z');
  });

  it('a live disconnect marks the node disconnected, keeping its last usage', () => {
    recordLiveHeartbeat('n1', {
      lastSeenAt: new Date('2026-10-31T09:00:00Z'),
      connected: true,
      usage: { cpuMillis: 900, memoryBytes: 2, diskBytes: 3 },
    });
    recordLiveDisconnect('n1', new Date('2026-10-31T09:01:00Z'));

    const row = stored();

    applyLiveHeartbeat(row, true);
    expect(row).toMatchObject({ connected: false, lastSeenAt: new Date('2026-10-31T09:01:00Z') });
    expect(row.usage?.cpuMillis).toBe(900);
  });

  it('applies to every loaded NodeEntity (after load)', () => {
    databaseTarget.setFallback(true);
    recordLiveHeartbeat('n1', { lastSeenAt: new Date('2026-10-31T09:00:00Z'), connected: true });

    const entity = Object.assign(new NodeEntity(), { name: 'n1', connected: false, lastSeenAt: null });

    (entity as unknown as { overlayLiveHeartbeat(): void }).overlayLiveHeartbeat();
    expect(entity.connected).toBe(true);
    expect(entity.lastSeenAt?.toISOString()).toBe('2026-10-31T09:00:00.000Z');
  });
});

describe('NodeAgentsService during the read-only fallback (3.43)', () => {
  afterEach(() => {
    clearLiveHeartbeats();
    databaseTarget.reset();
  });

  function service(found: boolean) {
    const update = jest.fn(async () => {
      throw new Error('cannot execute UPDATE in a read-only transaction');
    });
    const findOne = jest.fn(async () => (found ? { id: 'id-1' } : null));
    const dataSource = { getRepository: () => ({ update, findOne }) };
    const network = { requestRecompile: jest.fn() };

    return { agents: new NodeAgentsService(dataSource as never, {} as never, network as never, {} as never), update };
  }

  const heartbeat = {
    appliedRevision: 9,
    usage: { cpuMillis: 500, memoryBytes: 10, diskBytes: 20 },
    at: '2026-10-31T09:00:00.000Z',
    foreign: { containers: [{ id: 'abcdef123456', name: 'x', image: 'nginx', state: 'running', ports: [] }] },
  };

  it('keeps heartbeats in memory instead of writing (the node stays connected)', async () => {
    databaseTarget.setFallback(true);

    const { agents, update } = service(true);

    expect(await agents.handleHeartbeat('n1', heartbeat as never)).toBe(true);
    expect(update).not.toHaveBeenCalled();

    const row = { ...stored(), lastSeenAt: new Date(0), drift: null as unknown };

    applyLiveHeartbeat(row, true);
    expect(row).toMatchObject({ connected: true, appliedRevision: 9, usage: heartbeat.usage });
    expect((row.drift as { containers: unknown[] }).containers).toHaveLength(1);
    expect(Date.now() - (row.lastSeenAt as Date).getTime()).toBeLessThan(5_000);
  });

  it('a left / unknown node is told goodbye, as with the stored path', async () => {
    databaseTarget.setFallback(true);
    expect(await service(false).agents.handleHeartbeat('gone', heartbeat as never)).toBe(false);
  });

  it('a disconnect is recorded in memory, no write', async () => {
    jest.useFakeTimers();
    databaseTarget.setFallback(true);
    recordLiveHeartbeat('n1', { lastSeenAt: new Date(Date.now() - 1_000), connected: true });

    const { agents, update } = service(true);

    await agents.markDisconnected('n1');
    expect(update).not.toHaveBeenCalled();

    const row = { ...stored(), lastSeenAt: new Date(0) };

    applyLiveHeartbeat(row, true);
    expect(row.connected).toBe(false);
    jest.useRealTimers();
  });
});
