/**
 * Cron schedules (3.23): five fields `minute hour day-of-month month day-of-week` with lists, ranges, steps and
 * names, plus `@yearly`, `@monthly`, `@weekly`, `@daily`, `@hourly`. Evaluated in the job's timezone.
 */

const MACROS: Record<string, string> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
};
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export interface CronSchedule {
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  daysOfWeek: Set<number>;
  /** Classic cron: if both day fields are restricted, either may match. */
  dayOr: boolean;
}

function field(text: string, min: number, max: number, names?: string[]): Set<number> {
  const values = new Set<number>();
  const value = (token: string) => {
    const index = names?.indexOf(token.toLowerCase()) ?? -1;
    const n = index >= 0 ? index + (names === MONTHS ? 1 : 0) : Number(token);

    if (!Number.isInteger(n) || n < min || n > max) throw new Error(`invalid cron value ${token}`);

    return n;
  };

  for (const part of text.split(',')) {
    const [range, stepText] = part.split('/');
    const step = stepText === undefined ? 1 : Number(stepText);

    if (!Number.isInteger(step) || step < 1) throw new Error(`invalid cron step ${part}`);

    let start = min;
    let end = max;

    if (range !== '*') {
      const [a, b] = range.split('-');

      start = value(a);
      end = b === undefined ? (stepText === undefined ? start : max) : value(b);
    }

    if (start > end) throw new Error(`invalid cron range ${part}`);

    for (let v = start; v <= end; v += step) values.add(v);
  }

  return values;
}

export function parseCron(expression: string): CronSchedule {
  const text = MACROS[expression.trim().toLowerCase()] ?? expression.trim();
  const parts = text.split(/\s+/);

  if (parts.length !== 5) throw new Error('cron expressions have five fields');

  const daysOfWeek = field(parts[4], 0, 7, DAYS);

  // 7 is Sunday too.
  if (daysOfWeek.has(7)) {
    daysOfWeek.delete(7);
    daysOfWeek.add(0);
  }

  return {
    minutes: field(parts[0], 0, 59),
    hours: field(parts[1], 0, 23),
    daysOfMonth: field(parts[2], 1, 31),
    months: field(parts[3], 1, 12, MONTHS),
    daysOfWeek,
    dayOr: parts[2] !== '*' && parts[4] !== '*',
  };
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function localFields(
  instant: Date,
  timeZone: string,
): { minute: number; hour: number; day: number; month: number; weekday: number } {
  let formatter = formatters.get(timeZone);

  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      minute: 'numeric',
      hour: 'numeric',
      day: 'numeric',
      month: 'numeric',
      weekday: 'short',
    });
    formatters.set(timeZone, formatter);
  }

  const parts = Object.fromEntries(formatter.formatToParts(instant).map((p) => [p.type, p.value]));

  return {
    minute: Number(parts['minute']),
    hour: Number(parts['hour']),
    day: Number(parts['day']),
    month: Number(parts['month']),
    weekday: DAYS.indexOf(String(parts['weekday']).toLowerCase().slice(0, 3)),
  };
}

export function matches(schedule: CronSchedule, instant: Date, timeZone: string): boolean {
  const f = localFields(instant, timeZone);
  const dom = schedule.daysOfMonth.has(f.day);
  const dow = schedule.daysOfWeek.has(f.weekday);
  const day = schedule.dayOr ? dom || dow : dom && dow;

  return schedule.minutes.has(f.minute) && schedule.hours.has(f.hour) && schedule.months.has(f.month) && day;
}

/** Validates a timezone name (IANA). */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });

    return true;
  } catch {
    return false;
  }
}

/**
 * The most recent scheduled time at or before `at` (minute precision) and after `after`, searching back at most
 * `horizonDays`. Missed runs are not replayed one by one: only the latest due time counts (no catch-up storms).
 */
export function previousRun(
  expression: string,
  timeZone: string,
  at: Date,
  after?: Date,
  horizonDays = 7,
): Date | null {
  const schedule = parseCron(expression);
  const start = Math.floor(at.getTime() / 60_000) * 60_000;
  const limit = Math.max(start - horizonDays * 86_400_000, after ? after.getTime() + 1 : -Infinity);

  for (let t = start; t >= limit; t -= 60_000) {
    const instant = new Date(t);

    if (matches(schedule, instant, timeZone)) return instant;
  }

  return null;
}
