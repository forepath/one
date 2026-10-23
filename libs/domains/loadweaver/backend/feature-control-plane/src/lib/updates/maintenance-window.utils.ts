import {
  matchesSelector,
  WEEKDAYS,
  type MaintenanceWindowSpec,
  type Weekday,
} from '@forepath/loadweaver/shared/util-model';

/**
 * Maintenance windows (3.26): weekly recurrences in an IANA time zone. Start and end are wall-clock times on the
 * window's start day; an end before the start crosses midnight. DST is handled by converting wall-clock times of the
 * concrete day: a start inside a spring-forward gap moves to the first valid minute after it, and a window across a
 * fall-back night lasts one real hour longer, as clocks on the wall say.
 */

export interface WindowNode {
  name: string;
  site: string;
  labels: Record<string, string>;
}

export interface NamedWindow {
  name: string;
  spec: MaintenanceWindowSpec;
}

export interface Occurrence {
  window: string;
  start: Date;
  end: Date;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);

  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    formatters.set(timeZone, f);
  }

  return f;
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: Weekday;
}

/** The wall clock of an instant in a time zone. */
export function wallClock(instant: number, timeZone: string): WallClock {
  const parts = Object.fromEntries(
    formatter(timeZone)
      .formatToParts(new Date(instant))
      .map((p) => [p.type, p.value]),
  );

  return {
    year: Number(parts['year']),
    month: Number(parts['month']),
    day: Number(parts['day']),
    hour: Number(parts['hour']),
    minute: Number(parts['minute']),
    second: Number(parts['second']),
    weekday: parts['weekday'].toLowerCase().slice(0, 3) as Weekday,
  };
}

/** Offset of the time zone at an instant (ms to add to UTC to get the wall clock). */
function offsetAt(instant: number, timeZone: string): number {
  const w = wallClock(instant, timeZone);

  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - Math.floor(instant / 1000) * 1000;
}

/** The instant a wall-clock time happens in a time zone (gaps resolve forward, ambiguous times to the first). */
export function zonedInstant(
  date: { year: number; month: number; day: number },
  hour: number,
  minute: number,
  timeZone: string,
): number {
  const guess = Date.UTC(date.year, date.month - 1, date.day, hour, minute);
  // Every offset in effect around that day (both sides of a transition within ±14 h).
  const offsets = [...new Set([-14, 0, 14].map((h) => offsetAt(guess + h * 3600_000, timeZone)))];
  const candidates = offsets.map((o) => guess - o);
  const valid = candidates.filter((t) => {
    const w = wallClock(t, timeZone);

    return (
      w.year === date.year && w.month === date.month && w.day === date.day && w.hour === hour && w.minute === minute
    );
  });

  // Ambiguous (fall back): the earlier instant. A gap (spring forward): the time moves forward by the gap.
  return valid.length ? Math.min(...valid) : Math.max(...candidates);
}

function minutes(time: string): [number, number] {
  const [h, m] = time.split(':').map(Number);

  return [h, m];
}

function addDays(date: { year: number; month: number; day: number }, days: number) {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day + days));

  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function weekdayOf(date: { year: number; month: number; day: number }): Weekday {
  // 1970-01-05 was a Monday.
  const index = Math.floor(Date.UTC(date.year, date.month - 1, date.day) / 86_400_000) - 4;

  return WEEKDAYS[((index % 7) + 7) % 7];
}

/** Occurrences of a window starting on local days from `from` (wall-clock date) for `days` days. */
function occurrences(name: string, spec: MaintenanceWindowSpec, fromInstant: number, days: number): Occurrence[] {
  const local = wallClock(fromInstant, spec.timeZone);
  const start = minutes(spec.start);
  const end = minutes(spec.end);
  const crosses = end[0] * 60 + end[1] <= start[0] * 60 + start[1];
  const out: Occurrence[] = [];

  for (let i = -1; i < days; i++) {
    const day = addDays(local, i);

    if (!spec.days.includes(weekdayOf(day))) continue;

    const s = zonedInstant(day, start[0], start[1], spec.timeZone);
    const e = zonedInstant(crosses ? addDays(day, 1) : day, end[0], end[1], spec.timeZone);

    if (e > s) out.push({ window: name, start: new Date(s), end: new Date(e) });
  }

  return out;
}

/** The occurrence of the window that contains `at`, or null. */
export function openOccurrence(name: string, spec: MaintenanceWindowSpec, at: Date): Occurrence | null {
  return occurrences(name, spec, at.getTime(), 1).find((o) => o.start <= at && at < o.end) ?? null;
}

/** The current or next occurrence of the window (within the coming eight days). */
export function nextOccurrence(name: string, spec: MaintenanceWindowSpec, at: Date): Occurrence | null {
  return (
    occurrences(name, spec, at.getTime(), 8)
      .filter((o) => o.end > at)
      .sort((a, b) => a.start.getTime() - b.start.getTime())[0] ?? null
  );
}

/** Whether a window covers a node (sites and selector). */
export function windowApplies(spec: MaintenanceWindowSpec, node: WindowNode): boolean {
  if (spec.sites?.length && !spec.sites.includes(node.site)) return false;

  return matchesSelector(spec.selector ?? {}, { name: node.name, labels: node.labels });
}

export interface NodeWindowState {
  /** Windows that cover the node. */
  windows: string[];
  open: boolean;
  /** End of the open occurrence (the last one if several overlap). */
  closesAt: Date | null;
  /** Start of the next occurrence when closed. */
  opensAt: Date | null;
}

/** Whether update steps may disturb a node now. Nodes without any window are never inside one. */
export function nodeWindowState(windows: readonly NamedWindow[], node: WindowNode, at: Date): NodeWindowState {
  const covering = windows.filter((w) => windowApplies(w.spec, node));
  const open = covering.map((w) => openOccurrence(w.name, w.spec, at)).filter((o): o is Occurrence => !!o);

  if (open.length)
    return {
      windows: covering.map((w) => w.name),
      open: true,
      closesAt: new Date(Math.max(...open.map((o) => o.end.getTime()))),
      opensAt: null,
    };

  const next = covering
    .map((w) => nextOccurrence(w.name, w.spec, at))
    .filter((o): o is Occurrence => !!o)
    .sort((a, b) => a.start.getTime() - b.start.getTime())[0];

  return { windows: covering.map((w) => w.name), open: false, closesAt: null, opensAt: next?.start ?? null };
}
