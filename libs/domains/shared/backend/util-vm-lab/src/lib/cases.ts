import { FatalWait } from './process';

/**
 * Fail-fast helpers of the lab specs: case dependencies (a case whose prerequisite failed in this run fails at once
 * instead of waiting out its budget on a state that can't come) and stall detection for long waits.
 */

/**
 * Case dependencies within one spec file: `it('(b) …', cases.run('b', ['a'], async () => …))`. A case fails at once
 * when a case it requires **failed** in this process; a required case that didn't run (focused run `-t '(b)'`, e.g.
 * on a kept lab whose state it left earlier) doesn't block.
 */
export class LabCases {
  private readonly failed = new Map<string, string>();
  private readonly passed = new Set<string>();

  run(id: string, requires: readonly string[], body: () => Promise<void>): () => Promise<void> {
    return async () => {
      const blocked = requires.filter((r) => this.failed.has(r));

      if (blocked.length) {
        const reason = `(${id}) not run: it needs ${blocked.map((r) => `(${r})`).join(', ')}, which failed in this run`;

        this.failed.set(id, reason);
        throw new Error(reason);
      }

      try {
        await body();
        this.passed.add(id);
      } catch (error) {
        this.failed.set(id, error instanceof Error ? error.message : String(error));
        throw error;
      }
    };
  }

  /** A named step inside a case (e.g. the pushes of a case that also imports a URL): required like a case. */
  async step(id: string, body: () => Promise<void>): Promise<void> {
    await this.run(id, [], body)();
  }

  hasFailed(id: string): boolean {
    return this.failed.has(id);
  }

  hasPassed(id: string): boolean {
    return this.passed.has(id);
  }
}

/**
 * Stall detection inside an `eventually` poll: call the returned function with the current progress (any JSON-able
 * value: status, phase, bytes); it throws `FatalWait` when the progress hasn't changed for `stallMs`.
 */
export function stallGuard(what: string, stallMs: number, now: () => number = Date.now): (progress: unknown) => void {
  let last: string | undefined;
  let since = now();

  return (progress: unknown) => {
    const key = JSON.stringify(progress) ?? 'undefined';

    if (key !== last) {
      last = key;
      since = now();

      return;
    }

    if (now() - since > stallMs)
      throw new FatalWait(`${what}: no progress for ${Math.round(stallMs / 1000)} s (still ${key.slice(0, 400)})`);
  };
}

/**
 * Persistent-condition detection inside an `eventually` poll: `guard(label, holds, ms, detail)` throws `FatalWait` when
 * `holds` has been true at every poll for longer than `ms` (e.g. a VM `Failed` for 2 min, `Pending` for 5 min: a
 * transient state recovers sooner; a broken one doesn't recover by waiting out a 10-minute budget).
 */
export function persistGuard(
  what: string,
  now: () => number = Date.now,
): (label: string, holds: boolean, ms: number, detail?: () => string) => void {
  const since = new Map<string, number>();

  return (label, holds, ms, detail) => {
    if (!holds) {
      since.delete(label);

      return;
    }

    const start = since.get(label) ?? now();

    since.set(label, start);

    if (now() - start > ms)
      throw new FatalWait(`${what}: ${label} for ${Math.round(ms / 1000)} s${detail ? ` — ${detail()}` : ''}`);
  };
}

/** Throws `FatalWait` when `value` matches a terminal failure state (`/^(Failed|Error)/`, `failed`, …). */
export function failOnTerminal(what: string, value: unknown, terminal: RegExp, detail?: () => string): void {
  if (typeof value === 'string' && terminal.test(value))
    throw new FatalWait(`${what}: ended in ${value}${detail ? ` — ${detail()}` : ''}`);
}
