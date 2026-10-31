import { databaseTarget } from '../database-handover/database-target.runtime';
import { NodeEntity } from '../entities/node.entity';
import type { HealthNode } from './health-tree.utils';
import { HealthService, liveHealthRows, liveHealthStates } from './health.service';

const node = (key: string, state: HealthNode['state']): HealthNode => ({
  key,
  kind: 'node',
  name: key.replace('node/', ''),
  parent: 'cluster',
  project: null,
  state,
  reasons: [],
});

describe('health while the control plane is read-only (3.43 fallback)', () => {
  afterEach(() => databaseTarget.reset());

  it('keeps `since` for unchanged states and starts it now for changed ones', () => {
    const before = new Date('2026-10-30T16:09:05Z');
    const now = Date.parse('2026-10-31T09:00:00Z');
    const rows = liveHealthRows(
      [node('node/a', 'healthy'), node('node/b', 'failed'), node('node/c', 'unknown')],
      [
        { key: 'node/a', state: 'healthy', since: before },
        { key: 'node/b', state: 'healthy', since: before },
      ],
      now,
    );

    expect(rows.map((r) => [r.key, r.state, r.since.toISOString()])).toEqual([
      ['node/a', 'healthy', before.toISOString()],
      // A node that went away: failed from now on (the stored row said healthy and stayed frozen).
      ['node/b', 'failed', new Date(now).toISOString()],
      ['node/c', 'unknown', new Date(now).toISOString()],
    ]);
  });

  it('evaluates without storing during the fallback and serves that instead of the frozen rows', async () => {
    const now = Date.parse('2026-10-31T09:00:00Z');
    const stale = {
      key: 'node/n1',
      kind: 'node',
      name: 'n1',
      parent: 'site/default',
      project: null,
      state: 'healthy',
      reasons: [],
      since: new Date('2026-10-30T16:09:05Z'),
    };
    const node = {
      name: 'n1',
      site: 'default',
      lifecycle: 'active',
      connected: false,
      lastSeenAt: new Date(now - 3_600_000),
      controlPlane: true,
      witness: false,
      capacity: null,
      usage: null,
    };
    const transaction = jest.fn();
    const dataSource = {
      getRepository: (entity: unknown) => ({
        find: async () => (entity === NodeEntity ? [node] : []),
        findOne: async () => null,
      }),
      createQueryRunner: () => ({
        connect: async () => undefined,
        release: async () => undefined,
        query: async (sql: string) => (sql.includes('pg_try_advisory_lock') ? [{ locked: true }] : []),
      }),
      query: async () => [stale],
      transaction,
    };
    const service = new HealthService(dataSource as never, {} as never, {} as never);

    expect(liveHealthStates()).toBeNull();
    databaseTarget.setFallback(true);
    expect(await service.tick(now)).toBe(true);

    // Nothing written (the database is read-only); the node that went away is failed now, not "healthy".
    expect(transaction).not.toHaveBeenCalled();
    expect((await service.currentRows()).find((r) => r.key === 'node/n1')?.state).toBe('failed');
    expect(liveHealthStates()?.get('node/n1')).toBe('failed');

    // Writes work again: the stored rows count again (the next evaluation stores the tree).
    databaseTarget.setFallback(false);
    expect(liveHealthStates()).toBeNull();
    expect((await service.currentRows())[0]).toBe(stale);
  });
});
