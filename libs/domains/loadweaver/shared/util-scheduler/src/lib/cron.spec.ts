import { isValidTimeZone, matches, parseCron, previousRun } from './cron';

describe('cron', () => {
  it('parses lists, ranges, steps, names and macros', () => {
    const s = parseCron('*/15 9-17 * jan-mar mon-fri');

    expect([...s.minutes]).toEqual([0, 15, 30, 45]);
    expect(s.hours.has(9) && s.hours.has(17) && !s.hours.has(18)).toBe(true);
    expect([...s.months]).toEqual([1, 2, 3]);
    expect([...s.daysOfWeek]).toEqual([1, 2, 3, 4, 5]);
    expect([...parseCron('0 0 * * 7').daysOfWeek]).toEqual([0]);
    expect(parseCron('@daily')).toEqual(parseCron('0 0 * * *'));
  });

  it.each(['* * * *', '60 * * * *', '* 24 * * *', '*/0 * * * *', '5-1 * * * *', '* * * foo *'])(
    'rejects %s',
    (expr) => {
      expect(() => parseCron(expr)).toThrow();
    },
  );

  it('evaluates in the given timezone', () => {
    const schedule = parseCron('0 3 * * *');
    // 03:00 in Berlin during summer time is 01:00 UTC.
    const instant = new Date('2026-07-01T01:00:00Z');

    expect(matches(schedule, instant, 'Europe/Berlin')).toBe(true);
    expect(matches(schedule, instant, 'UTC')).toBe(false);
  });

  it('finds the latest due time', () => {
    expect(previousRun('0 3 * * *', 'UTC', new Date('2026-07-02T10:15:30Z'))?.toISOString()).toBe(
      '2026-07-02T03:00:00.000Z',
    );
    expect(previousRun('*/5 * * * *', 'UTC', new Date('2026-07-02T10:17:00Z'))?.toISOString()).toBe(
      '2026-07-02T10:15:00.000Z',
    );
    expect(previousRun('0 0 29 2 *', 'UTC', new Date('2026-07-02T00:00:00Z'))).toBeNull();
    // Nothing new since the last run.
    expect(
      previousRun('0 3 * * *', 'UTC', new Date('2026-07-02T10:15:30Z'), new Date('2026-07-02T03:00:00Z')),
    ).toBeNull();
    expect(
      previousRun(
        '0 3 * * *',
        'UTC',
        new Date('2026-07-03T03:00:10Z'),
        new Date('2026-07-02T03:00:00Z'),
      )?.toISOString(),
    ).toBe('2026-07-03T03:00:00.000Z');
  });

  it('treats restricted day-of-month and day-of-week as either', () => {
    const s = parseCron('0 0 1 * mon');

    expect(matches(s, new Date('2026-06-01T00:00:00Z'), 'UTC')).toBe(true); // the 1st (a Monday)
    expect(matches(s, new Date('2026-06-08T00:00:00Z'), 'UTC')).toBe(true); // a Monday
    expect(matches(s, new Date('2026-06-02T00:00:00Z'), 'UTC')).toBe(false);
  });

  it('validates timezones', () => {
    expect(isValidTimeZone('Europe/Berlin')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
  });
});
