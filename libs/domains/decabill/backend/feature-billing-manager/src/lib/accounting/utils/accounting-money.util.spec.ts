import { addDays, addMonths, endOfMonth, quarterOf, toBookingDate } from './accounting-date.util';
import { allocateCents, fromCents, toCents } from './accounting-money.util';

describe('accounting money / date utils', () => {
  it('converts to integer cents without float drift', () => {
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents('19.99')).toBe(1999);
    expect(fromCents(1999)).toBe(19.99);
  });

  it('allocates cents proportionally and exactly', () => {
    const parts = allocateCents(1000, [1, 1, 1]);

    expect(parts.reduce((a, b) => a + b, 0)).toBe(1000);
    expect(parts.sort()).toEqual([333, 333, 334]);
  });

  it('does calendar arithmetic on ISO dates', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(endOfMonth('2028-02-10')).toBe('2028-02-29');
    expect(quarterOf('2026-11-20')).toBe(4);
  });

  it('derives the booking date in the bookkeeping time zone', () => {
    // 23:30 UTC on 31 Dec is already 1 Jan in Berlin.
    expect(toBookingDate(new Date('2026-12-31T23:30:00Z'), 'Europe/Berlin')).toBe('2027-01-01');
    expect(toBookingDate('2026-05-05', 'Europe/Berlin')).toBe('2026-05-05');
  });
});
