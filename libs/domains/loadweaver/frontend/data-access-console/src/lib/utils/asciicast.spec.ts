import {
  AsciicastError,
  compressIdle,
  delayToNext,
  eventsUntil,
  outputUntil,
  parseAsciicast,
  parseResize,
} from './asciicast';

const CAST = [
  '{"version": 2, "width": 120, "height": 32, "timestamp": 1760778723, "title": "replica/shop/web/api/0"}',
  '[0.25, "o", "$ "]',
  '[1.0, "o", "ls\\r\\n"]',
  'not json',
  '[1.0, "x", "unknown code"]',
  '[0.9, "o", "jitter"]',
  '[2.5, "r", "100x30"]',
  '[12.5, "o", "done\\r\\n"]',
  '',
].join('\n');

describe('asciicast', () => {
  it('parses the header and the events, skipping bad lines and keeping time monotonic', () => {
    const cast = parseAsciicast(CAST);

    expect(cast.header).toEqual({
      version: 2,
      width: 120,
      height: 32,
      timestamp: 1760778723,
      title: 'replica/shop/web/api/0',
    });
    expect(cast.events.map((e) => [e.time, e.code, e.data])).toEqual([
      [0.25, 'o', '$ '],
      [1, 'o', 'ls\r\n'],
      [1, 'o', 'jitter'],
      [2.5, 'r', '100x30'],
      [12.5, 'o', 'done\r\n'],
    ]);
    expect(cast.duration).toBe(12.5);
  });

  it('rejects what is not asciicast v2', () => {
    expect(() => parseAsciicast('')).toThrow(AsciicastError);
    expect(() => parseAsciicast('{"version": 1}')).toThrow('not an asciicast v2 recording');
    expect(() => parseAsciicast('[0, "o", "x"]')).toThrow(AsciicastError);
    expect(() => parseAsciicast('nope')).toThrow('the header is not JSON');
    expect(parseAsciicast('{"version":2}').header).toMatchObject({ width: 80, height: 24 });
  });

  it('caps idle time between events', () => {
    const cast = compressIdle(parseAsciicast(CAST), 2);

    expect(cast.events.map((e) => e.time)).toEqual([0.25, 1, 1, 2.5, 4.5]);
    expect(cast.duration).toBe(4.5);
    expect(compressIdle(parseAsciicast(CAST), null).duration).toBe(12.5);
  });

  it('parses resizes', () => {
    expect(parseResize('100x30')).toEqual({ cols: 100, rows: 30 });
    expect(parseResize('wide')).toBeNull();
  });

  it('steps through events with the delay at a speed', () => {
    const cast = parseAsciicast(CAST);
    let cursor = { index: 0, position: 0 };

    expect(delayToNext(cast, cursor, 1)).toBe(250);
    expect(delayToNext(cast, cursor, 2)).toBe(125);

    const first = eventsUntil(cast, cursor, 1);

    expect(first.events.map((e) => e.data)).toEqual(['$ ', 'ls\r\n', 'jitter']);
    cursor = first.cursor;
    expect(cursor).toEqual({ index: 3, position: 1 });
    expect(delayToNext(cast, cursor, 1)).toBe(1500);

    cursor = eventsUntil(cast, cursor, 100).cursor;
    expect(cursor).toEqual({ index: 5, position: 12.5 });
    expect(delayToNext(cast, cursor, 1)).toBeNull();
  });

  it('collects the output up to a time for seeking', () => {
    expect(outputUntil(parseAsciicast(CAST), 1)).toBe('$ ls\r\njitter');
  });
});
