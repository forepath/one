import { billingChartTimeAxis } from './billing-chart';
import {
  formatBillingClockRange,
  formatBillingDate,
  formatBillingDateRange,
  formatBillingDateTime,
  formatBillingMoney,
} from './billing-format';
import { nextBillingDate, NextBillingDayPipe } from './pipes/next-billing-day.pipe';
import {
  formatProjectHourlyRate,
  formatProjectOpenBillableAmount,
  formatSubscriptionPriceCell,
  getBillingIntervalDurationLabel,
  getBillingIntervalTypeLabel,
  getPromotionAdvantageText,
  getPromotionFreeDaysLabel,
  getPromotionFreePeriodsLabel,
} from './billing-status-labels';
import { DEFAULT_BILLING_COUNTRY_CODE, withOptionalCountry } from './billing-country-default';

// The country list registers i18n-iso-countries locales (JSON import), not needed here.
jest.mock('./billing-country-options', () => ({ getCountryDisplayName: (code: string) => code }));

describe('billing formats (DB-03 / DB-05)', () => {
  it('formats money with grouping, symbol and 2 decimals', () => {
    expect(formatBillingMoney(65059.45)).toBe('€65,059.45');
    expect(formatBillingMoney(5)).toBe('€5.00');
    expect(formatBillingMoney(null)).toBe('-');
  });

  it('keeps unit-price precision below one cent', () => {
    expect(formatBillingMoney(0.004, 'EUR', { unitPrice: true })).toBe('€0.004');
    expect(formatBillingMoney(250, 'EUR', { unitPrice: true })).toBe('€250.00');
  });

  it('formats dates and date-times without seconds', () => {
    const at = new Date(2026, 9, 29, 10, 5, 33);

    expect(formatBillingDate(at)).toBe('Oct 29, 2026');
    expect(formatBillingDateTime(at)).not.toContain(':33');
    expect(formatBillingDate(null)).toBe('-');
  });

  it('formats open-ended ranges as "from …"', () => {
    expect(formatBillingDateRange(new Date(2026, 9, 29), null)).toBe('from Oct 29, 2026');
  });

  it('computes the next billing day', () => {
    const now = new Date(2026, 9, 29);

    expect(nextBillingDate(28, now)).toEqual(new Date(2026, 10, 28));
    expect(nextBillingDate(30, now)).toBeNull();
    expect(new NextBillingDayPipe().transform(null)).toBe('');
  });
});

describe('interval and plural labels (DB-04 / DB-08 b / DB-27)', () => {
  it('maps interval types to labels', () => {
    expect(getBillingIntervalTypeLabel('month')).toBe('Months');
    expect(getBillingIntervalTypeLabel('hour')).toBe('Hours');
  });

  it('uses real plural forms', () => {
    expect(getBillingIntervalDurationLabel(1, 'month')).toBe('1 month');
    expect(getBillingIntervalDurationLabel(3, 'month')).toBe('3 months');
    expect(getBillingIntervalDurationLabel(14, 'day')).toBe('14 days');
    expect(getPromotionFreeDaysLabel(1)).toBe('1 day free');
    expect(getPromotionFreePeriodsLabel(2)).toBe('2 billing periods free');
  });

  it('prefers localized advantage text when the numbers are known', () => {
    expect(getPromotionAdvantageText({ advantageType: 'free_days', days: 14, advantageSummary: 'x' })).toBe(
      '14 days free',
    );
    expect(getPromotionAdvantageText({ advantageType: 'fixed_amount_net', advantageSummary: '10.00 EUR credit' })).toBe(
      '10.00 EUR credit',
    );
    expect(
      getPromotionAdvantageText({
        advantageType: 'fixed_amount_net',
        amountNet: 5,
        currency: 'EUR',
        advantageSummary: '5.00 EUR credit',
      }),
    ).toBe('€5.00 credit');
  });

  it('formats project rates and amounts with the one money format (DB-03)', () => {
    expect(formatProjectHourlyRate(110, 'EUR')).toBe('€110.00 / h');
    expect(formatProjectOpenBillableAmount(1210, 'EUR')).toBe('€1,210.00');
    expect(formatProjectOpenBillableAmount(Number.NaN, 'EUR')).toBe('€0.00');
  });
});

describe('subscription price cell (DB-19)', () => {
  const fmt = (n: number) => `€${n.toFixed(2)}`;

  it('adds the interval', () => {
    expect(formatSubscriptionPriceCell(5.95, { value: 1, type: 'month' }, false, fmt)).toBe('€5.95 / Monthly');
  });

  it('reads "Usage-based" for postpaid rows', () => {
    expect(formatSubscriptionPriceCell(undefined, null, true, fmt)).toBe('Usage-based');
    expect(formatSubscriptionPriceCell(undefined, null, false, fmt)).toBe('-');
  });
});

describe('country default (DB-10)', () => {
  it('has no preselected country and omits an empty one', () => {
    expect(DEFAULT_BILLING_COUNTRY_CODE).toBe('');
    expect(withOptionalCountry({ city: 'Bonn', country: '' })).toEqual({ city: 'Bonn' });
    expect(withOptionalCountry({ country: 'DE' })).toEqual({ country: 'DE' });
  });
});

describe('time-entry clock range (DB-05)', () => {
  it('shows times only on one day and date-times across days, never seconds', () => {
    const sameDay = formatBillingClockRange(new Date(2026, 9, 29, 10, 5), new Date(2026, 9, 29, 11, 30));

    expect(sameDay).toBe('10:05 AM – 11:30 AM');
    expect(formatBillingClockRange(new Date(2026, 9, 29, 22, 0), new Date(2026, 9, 30, 1, 0))).toBe(
      'Oct 29, 2026, 10:00 PM – Oct 30, 2026, 1:00 AM',
    );
    expect(formatBillingClockRange('x', null)).toBe('-');
  });
});

describe('chart time axis (DB-21)', () => {
  it('uses the shared category axis with at most 6 ticks', () => {
    const axis = billingChartTimeAxis(['Oct 1', 'Oct 2']);

    expect(axis).toEqual(
      expect.objectContaining({ type: 'category', tickPlacement: 'on', categories: ['Oct 1', 'Oct 2'] }),
    );
    expect(axis.labels).toEqual(expect.objectContaining({ rotate: 0, trim: false }));
  });
});
