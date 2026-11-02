import type { DataSource } from 'typeorm';

import { gitConcurrency, GitLeases, Semaphore } from './git-locks';

/** An in-memory `lw_git_locks` speaking the statements GitLeases uses. */
function fakeLocks() {
  const rows = new Map<string, { owner: string; expiresAt: number }>();
  const dataSource = {
    query: jest.fn(async (sql: string, params: unknown[]) => {
      const [key, owner, ms] = params as [string, string, number];

      if (sql.startsWith('INSERT')) {
        const held = rows.get(key);

        if (held && held.expiresAt >= Date.now()) return [];

        rows.set(key, { owner, expiresAt: Date.now() + ms });

        return [{ key }];
      }

      if (sql.startsWith('UPDATE')) {
        const held = rows.get(key);

        if (held?.owner === owner) held.expiresAt = Date.now() + ms;

        return [];
      }

      if (sql.startsWith('DELETE')) {
        if (rows.get(key)?.owner === owner) rows.delete(key);

        return [];
      }

      throw new Error(sql);
    }),
  } as unknown as DataSource;

  return { rows, dataSource };
}

describe('Git leases (M5)', () => {
  it('serializes holders of one key across "replicas" without holding a connection', async () => {
    const { rows, dataSource } = fakeLocks();
    const a = new GitLeases(dataSource);
    const b = new GitLeases(dataSource);
    const order: string[] = [];
    let release!: () => void;
    const first = a.withLease('connection:1', async () => {
      order.push('a:start');
      await new Promise<void>((r) => (release = r));
      order.push('a:end');
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(rows.get('connection:1')?.owner).toBe(a.owner);

    const second = b.withLease('connection:1', async () => {
      order.push('b');
    });

    await new Promise((r) => setTimeout(r, 150));
    expect(order).toEqual(['a:start']);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(['a:start', 'a:end', 'b']);
    expect(rows.size).toBe(0);
  });

  it('takes over expired leases, skips held ones with ifFree, releases on errors', async () => {
    const { rows, dataSource } = fakeLocks();
    const leases = new GitLeases(dataSource);

    rows.set('loop', { owner: 'crashed', expiresAt: Date.now() - 1 });
    expect(await leases.ifFree('loop', async () => 1)).toEqual({ value: 1 });

    rows.set('loop', { owner: 'other', expiresAt: Date.now() + 60_000 });
    expect(await leases.ifFree('loop', async () => 1)).toBeNull();

    await expect(
      leases.withLease('k', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(rows.has('k')).toBe(false);
  });

  it('gives up waiting when stopping', async () => {
    const { rows, dataSource } = fakeLocks();

    rows.set('k', { owner: 'other', expiresAt: Date.now() + 60_000 });
    await expect(
      new GitLeases(dataSource).withLease(
        'k',
        async () => 1,
        () => true,
      ),
    ).rejects.toThrow('stopping');
  });

  it('bounds concurrent Git operations', async () => {
    const slots = new Semaphore(2);
    let running = 0;
    let peak = 0;

    await Promise.all(
      Array.from({ length: 6 }, () =>
        slots.run(async () => {
          running++;
          peak = Math.max(peak, running);
          await new Promise((r) => setTimeout(r, 10));
          running--;
        }),
      ),
    );
    expect(peak).toBe(2);
    expect(slots.inUse).toBe(0);
    expect(gitConcurrency({})).toBe(4);
    expect(gitConcurrency({ LOADWEAVER_GIT_CONCURRENCY: '2' })).toBe(2);
    expect(gitConcurrency({ LOADWEAVER_GIT_CONCURRENCY: '0' })).toBe(4);
  });
});
