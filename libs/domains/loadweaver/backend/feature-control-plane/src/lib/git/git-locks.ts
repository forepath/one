import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';

import type { DataSource } from 'typeorm';

/** A lease lives this long without renewal (a crashed replica's lease expires). */
export const GIT_LEASE_MS = 120_000;
/** Held leases are renewed this often. */
const RENEW_MS = 30_000;
/** Waiting for a lease held elsewhere: backoff between attempts. */
const MIN_BACKOFF_MS = 100;
const MAX_BACKOFF_MS = 2_000;

/** A counting semaphore (bounded concurrency of Git operations in this process). */
export class Semaphore {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(readonly limit: number) {}

  get inUse(): number {
    return this.active;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>((resolve) => this.waiting.push(resolve));
    else this.active++;

    try {
      return await fn();
    } finally {
      const next = this.waiting.shift();

      // The slot passes to the next waiter directly (no gap another caller could slip into).
      if (next) next();
      else this.active--;
    }
  }
}

/** Git operations per process: bounded so they never take more than a few pooled database connections. */
export function gitConcurrency(env: NodeJS.ProcessEnv = process.env): number {
  const value = Number(env['LOADWEAVER_GIT_CONCURRENCY']);

  return Number.isInteger(value) && value >= 1 && value <= 32 ? value : 4;
}

/**
 * Leases in `lw_git_locks` (3.29): serialize Git work per connection (and the sync loop) across replicas without
 * holding a database connection while git clones / pushes. Taking, renewing and releasing a lease are single short
 * statements; a lease another replica holds is waited for with backoff; leases of crashed replicas expire.
 * In-process callers of the same key queue locally first.
 */
export class GitLeases {
  readonly owner = `${hostname().slice(0, 30)}-${process.pid}-${randomUUID().slice(0, 8)}`;
  private readonly local = new Map<string, Promise<unknown>>();

  constructor(
    private readonly dataSource: DataSource,
    private readonly leaseMs = GIT_LEASE_MS,
  ) {}

  /** Takes the lease if it is free (or expired); true if this process holds it now. */
  async tryAcquire(key: string): Promise<boolean> {
    const rows: unknown = await this.dataSource.query(
      `INSERT INTO "lw_git_locks" ("key", "owner", "expires_at")
       VALUES ($1, $2, now() + ($3::int * interval '1 millisecond'))
       ON CONFLICT ("key") DO UPDATE SET "owner" = EXCLUDED."owner", "expires_at" = EXCLUDED."expires_at"
       WHERE "lw_git_locks"."expires_at" < now()
       RETURNING "key"`,
      [key, this.owner, this.leaseMs],
    );

    return Array.isArray(rows) && rows.length > 0;
  }

  async release(key: string): Promise<void> {
    await this.dataSource.query(`DELETE FROM "lw_git_locks" WHERE "key" = $1 AND "owner" = $2`, [key, this.owner]);
  }

  private async renew(key: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE "lw_git_locks" SET "expires_at" = now() + ($3::int * interval '1 millisecond') WHERE "key" = $1 AND "owner" = $2`,
      [key, this.owner, this.leaseMs],
    );
  }

  /** Runs `fn` holding the lease (renewed meanwhile); null without waiting if it is held elsewhere. */
  async ifFree<T>(key: string, fn: () => Promise<T>): Promise<{ value: T } | null> {
    if (!(await this.tryAcquire(key))) return null;

    return { value: await this.holding(key, fn) };
  }

  /** Runs `fn` holding the lease: queued behind this process's holders, then polled with backoff across replicas. */
  async withLease<T>(key: string, fn: () => Promise<T>, shouldStop: () => boolean = () => false): Promise<T> {
    const previous = this.local.get(key) ?? Promise.resolve();
    const run = previous
      .catch(() => undefined)
      .then(async () => {
        for (let delay = MIN_BACKOFF_MS; !(await this.tryAcquire(key)); delay = Math.min(delay * 2, MAX_BACKOFF_MS)) {
          if (shouldStop()) throw new Error(`stopping: lease ${key} not taken`);

          await new Promise((resolve) => setTimeout(resolve, delay + Math.floor(Math.random() * 50)));
        }

        return await this.holding(key, fn);
      });

    this.local.set(key, run);

    try {
      return await run;
    } finally {
      if (this.local.get(key) === run) this.local.delete(key);
    }
  }

  private async holding<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const timer = setInterval(() => void this.renew(key).catch(() => undefined), Math.min(RENEW_MS, this.leaseMs / 3));

    try {
      return await fn();
    } finally {
      clearInterval(timer);
      await this.release(key).catch(() => undefined);
    }
  }
}
