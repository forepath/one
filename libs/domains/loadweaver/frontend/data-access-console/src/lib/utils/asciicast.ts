/**
 * asciicast v2 (https://docs.asciinema.org/manual/asciicast/v2/), the format of terminal recordings (3.19): a JSON
 * header line, then one `[time, code, data]` array per line (`o` output, `i` input, `r` resize `COLSxROWS`, `m`
 * marker). Parsing and the playback timing live here, the player only writes what they return.
 */

export interface AsciicastHeader {
  version: 2;
  width: number;
  height: number;
  timestamp?: number;
  title?: string;
  /** Idle time cap the recorder suggests (seconds). */
  idleTimeLimit?: number;
}

export interface AsciicastEvent {
  /** Seconds since the start. */
  time: number;
  code: 'o' | 'i' | 'r' | 'm';
  data: string;
}

export interface Asciicast {
  header: AsciicastHeader;
  events: AsciicastEvent[];
  /** Seconds (the last event's time). */
  duration: number;
}

export class AsciicastError extends Error {}

const CODES = new Set(['o', 'i', 'r', 'm']);

/** Parses a cast; throws `AsciicastError` for something that isn't asciicast v2. Bad event lines are skipped. */
export function parseAsciicast(text: string): Asciicast {
  const lines = text.split(/\r?\n/);
  const first = lines.findIndex((line) => line.trim() !== '');

  if (first < 0) throw new AsciicastError('empty recording');

  let raw: unknown;

  try {
    raw = JSON.parse(lines[first]);
  } catch {
    throw new AsciicastError('the header is not JSON');
  }

  const head = raw as Record<string, unknown>;

  if (!head || typeof head !== 'object' || Array.isArray(head) || head['version'] !== 2)
    throw new AsciicastError('not an asciicast v2 recording');

  const header: AsciicastHeader = {
    version: 2,
    width: positive(head['width'], 80),
    height: positive(head['height'], 24),
    ...(typeof head['timestamp'] === 'number' ? { timestamp: head['timestamp'] } : {}),
    ...(typeof head['title'] === 'string' ? { title: head['title'] } : {}),
    ...(typeof head['idle_time_limit'] === 'number' && head['idle_time_limit'] > 0
      ? { idleTimeLimit: head['idle_time_limit'] }
      : {}),
  };
  const events: AsciicastEvent[] = [];
  let last = 0;

  for (const line of lines.slice(first + 1)) {
    if (!line.trim()) continue;

    let event: unknown;

    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }

    if (!Array.isArray(event) || event.length < 3) continue;

    const [time, code, data] = event as [unknown, unknown, unknown];

    if (typeof time !== 'number' || !Number.isFinite(time) || typeof code !== 'string' || !CODES.has(code)) continue;

    // Times never go backwards (a sloppy recorder's jitter would otherwise reorder output).
    last = Math.max(last, time);
    events.push({ time: last, code: code as AsciicastEvent['code'], data: typeof data === 'string' ? data : '' });
  }

  return { header, events, duration: events.at(-1)?.time ?? 0 };
}

function positive(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
}

/** Caps pauses between events at `limit` seconds (as `asciinema play -i` does); `null` keeps the timing. */
export function compressIdle(cast: Asciicast, limit: number | null): Asciicast {
  if (limit === null || !(limit > 0)) return cast;

  let previous = 0;
  let shifted = 0;
  const events = cast.events.map((event) => {
    const gap = event.time - previous;

    previous = event.time;
    shifted += Math.min(gap, limit);

    return { ...event, time: shifted };
  });

  return { ...cast, events, duration: events.at(-1)?.time ?? 0 };
}

/** `COLSxROWS` of a resize event. */
export function parseResize(data: string): { cols: number; rows: number } | null {
  const match = /^(\d{1,4})x(\d{1,4})$/.exec(data.trim());

  return match ? { cols: Number(match[1]), rows: Number(match[2]) } : null;
}

/**
 * Playback position over a cast: which events are due at a time, and how long to wait for the next one. The player
 * keeps `index` (the next event) and `position` (seconds of cast time).
 */
export interface CastCursor {
  index: number;
  position: number;
}

/** The events due between the cursor and `until` (cast time), and the cursor after them. */
export function eventsUntil(
  cast: Asciicast,
  cursor: CastCursor,
  until: number,
): { events: AsciicastEvent[]; cursor: CastCursor } {
  let index = cursor.index;

  while (index < cast.events.length && cast.events[index].time <= until) index++;

  return {
    events: cast.events.slice(cursor.index, index),
    cursor: { index, position: Math.min(Math.max(until, cursor.position), cast.duration) },
  };
}

/** Milliseconds of wall time until the next event at `speed`; `null` at the end. */
export function delayToNext(cast: Asciicast, cursor: CastCursor, speed: number): number | null {
  const next = cast.events[cursor.index];

  if (!next) return null;

  return Math.max(0, ((next.time - cursor.position) * 1000) / (speed > 0 ? speed : 1));
}

/** The output to write when jumping to `time` from the start (a reset terminal first). */
export function outputUntil(cast: Asciicast, time: number): string {
  return cast.events
    .filter((event) => event.code === 'o' && event.time <= time)
    .map((event) => event.data)
    .join('');
}
