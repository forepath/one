import { LOCALE_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import {
  fpcFormatDate,
  fpcFormatDateRange,
  fpcFormatDateTime,
  fpcFormatDuration,
  fpcFormatMoney,
  fpcFormatNumber,
  fpcFormatRelative,
  fpcPlural,
  fpcToDate,
} from './format';
import { FpcDatePipe, FpcMoneyPipe } from './format.pipes';

// Intl output uses narrow / non-breaking spaces in places; compare on normalised spaces.
const norm = (text: string) => text.replace(/[\u00a0\u202f\u2009]/g, ' ');

describe('fpc formats', () => {
  it('formats money with grouping, 2 decimals and the locale symbol position', () => {
    expect(fpcFormatMoney(65059.45, 'EUR', 'en-US')).toBe('€65,059.45');
    expect(norm(fpcFormatMoney(65059.45, 'eur', 'de'))).toBe('65.059,45 €');
    expect(fpcFormatMoney('10591', 'EUR', 'en-US')).toBe('€10,591.00');
    expect(fpcFormatMoney(5, 'EUR', 'en-US')).toBe('€5.00');
    expect(fpcFormatMoney(250, 'EUR', 'en-US', { unitPrice: true })).toBe('€250.00');
  });

  it('keeps up to 4 decimals only for tiny unit prices', () => {
    expect(fpcFormatMoney(0.004, 'EUR', 'en-US', { unitPrice: true })).toBe('€0.004');
    expect(fpcFormatMoney(0.004, 'EUR', 'en-US')).toBe('€0.00');
    expect(fpcFormatMoney(0, 'EUR', 'en-US', { unitPrice: true })).toBe('€0.00');
  });

  it('compacts axis values and returns the fallback for empty / invalid amounts', () => {
    expect(fpcFormatMoney(25000, 'EUR', 'en-US', { compact: true })).toBe('€25K');
    expect(fpcFormatMoney(null, 'EUR', 'en-US', { fallback: '—' })).toBe('—');
    expect(fpcFormatMoney('abc', 'EUR', 'en-US')).toBe('');
    expect(fpcFormatNumber(1234.5, 'en-US')).toBe('1,234.5');
  });

  it('formats one date and one date-time without seconds', () => {
    const at = new Date(2026, 9, 29, 10, 5, 33);

    expect(fpcFormatDate(at, 'en-US')).toBe('Oct 29, 2026');
    expect(norm(fpcFormatDateTime(at, 'en-US'))).toBe('Oct 29, 2026, 10:05 AM');
    expect(fpcFormatDateTime(at, 'en-US')).not.toContain(':33');
    expect(fpcFormatDate('not a date', 'en-US', '—')).toBe('—');
    expect(fpcToDate(undefined)).toBeNull();
  });

  it('formats ranges in one piece and open ranges with a label', () => {
    const start = new Date(2026, 9, 9);
    const end = new Date(2026, 11, 31);

    expect(norm(fpcFormatDateRange(start, end, 'en-US'))).toBe('Oct 9 – Dec 31, 2026');
    expect(fpcFormatDateRange(new Date(2026, 9, 29), null, 'en-US')).toBe('from Oct 29, 2026');
    expect(fpcFormatDateRange(null, end, 'en-US', { labels: { until: 'bis {date}' } })).toBe('bis Dec 31, 2026');
    expect(fpcFormatDateRange(null, null, 'en-US', { fallback: '—' })).toBe('—');
  });

  it('formats relative times and falls back to the date after a week', () => {
    const now = new Date(2026, 9, 29, 12, 0, 0);

    expect(fpcFormatRelative(new Date(2026, 9, 29, 10, 0, 0), 'en-US', { now })).toBe('2 hr. ago');
    expect(fpcFormatRelative(new Date(2026, 9, 29, 11, 59, 58), 'en-US', { now })).toBe('2 sec. ago');
    expect(fpcFormatRelative(new Date(2026, 9, 1), 'en-US', { now })).toBe('Oct 1, 2026');
  });

  it('uses real plural forms', () => {
    expect(fpcFormatDuration(1, 'month', 'en-US')).toBe('1 month');
    expect(fpcFormatDuration(3, 'month', 'en-US')).toBe('3 months');
    expect(fpcFormatDuration(14, 'day', 'de')).toBe('14 Tage');
    expect(fpcPlural(1, { one: '{count} highlight', other: '{count} highlights' }, 'en-US')).toBe('1 highlight');
    expect(fpcPlural(1200, { one: '{count} highlight', other: '{count} highlights' }, 'en-US')).toBe(
      '1,200 highlights',
    );
    expect(fpcPlural(0, { zero: 'none', other: '{count} highlights' }, 'en-US')).toBe('none');
  });

  it('pipes read LOCALE_ID', () => {
    TestBed.configureTestingModule({ providers: [{ provide: LOCALE_ID, useValue: 'de' }] });

    const money = TestBed.runInInjectionContext(() => new FpcMoneyPipe());
    const date = TestBed.runInInjectionContext(() => new FpcDatePipe());

    expect(norm(money.transform(1210, 'EUR'))).toBe('1.210,00 €');
    expect(date.transform(new Date(2026, 9, 29), 'date')).toBe('29.10.2026');
    expect(date.transform(null, 'datetime', '—')).toBe('—');
  });
});
