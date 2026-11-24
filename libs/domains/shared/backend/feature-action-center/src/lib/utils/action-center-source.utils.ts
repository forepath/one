import type {
  ActionCenterSqlRunner,
  ActionCenterAudience,
  ActionCenterGroupDraft,
  ActionCenterItem,
  ActionCenterParams,
  ActionCenterSeverity,
} from '../interfaces/action-center.types';

/** Static description of a task group; sources add the live count and items. */
export interface ActionCenterTaskDefinition {
  type: string;
  category: string;
  severity: ActionCenterSeverity;
  audience?: ActionCenterAudience;
}

/** A task group, or nothing when there is nothing to do. */
export function taskGroup(
  definition: ActionCenterTaskDefinition,
  total: number,
  items: ActionCenterItem[] = [],
  params?: ActionCenterParams,
): ActionCenterGroupDraft[] {
  const count = Math.max(total, items.length);

  if (count <= 0) {
    return [];
  }

  return [{ ...definition, kind: 'task', total: count, items, params }];
}

/** A setup suggestion (onboarding / configuration), or nothing when `open` is false. */
export function setupGroup(
  definition: ActionCenterTaskDefinition,
  open: boolean,
  params?: ActionCenterParams,
): ActionCenterGroupDraft[] {
  return open ? [{ ...definition, kind: 'setup', total: 1, items: [], params }] : [];
}

/** Postgres `COUNT(*)` values arrive as strings. */
export function toCount(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? '0'), 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/** Postgres numerics arrive as strings; keep money exact as string, `null` when missing. */
export function toDecimalString(value: unknown): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  return String(value);
}

export function toIsoString(value: Date | string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Only the date part (`YYYY-MM-DD`) of date columns / values. */
export function toDateString(value: Date | string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  return toIsoString(value)?.slice(0, 10) ?? null;
}

/** Whether the effective (override-aware) setting `key` has a non-blank value. */
export function hasSettingValue(key: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return (env[key] ?? '').trim().length > 0;
}

/** The keys of `keys` without a value (in order). */
export function missingSettings(keys: readonly string[], env: NodeJS.ProcessEnv = process.env): string[] {
  return keys.filter((key) => !hasSettingValue(key, env));
}

/** Default number of concurrent queries of one source (keeps recomputes from draining the connection pool). */
export const ACTION_CENTER_SQL_CONCURRENCY = 3;

/**
 * Wraps a SQL runner so that at most `max` of its queries run at the same time; sources keep writing their queries
 * with `Promise.all` while the database pool stays available for regular traffic.
 */
export function limitActionCenterSql(
  runner: ActionCenterSqlRunner,
  max: number = ACTION_CENTER_SQL_CONCURRENCY,
): ActionCenterSqlRunner {
  let active = 0;
  const waiting: Array<() => void> = [];
  const acquire = async (): Promise<void> => {
    if (active < max) {
      active += 1;

      return;
    }

    await new Promise<void>((resolve) => waiting.push(resolve));
  };
  const release = (): void => {
    const next = waiting.shift();

    if (next) {
      next();
    } else {
      active -= 1;
    }
  };

  return {
    query: async (sql, parameters) => {
      await acquire();

      try {
        return await runner.query(sql, parameters);
      } finally {
        release();
      }
    },
  };
}
