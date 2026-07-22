import {
  calculateOverlapMs,
  calculateProratedDiscount,
  getBillingPeriodDurationMs,
  getBillingPeriodEnd,
} from './billing-period.util';

describe('billing-period.util', () => {
  const dayBilling = { billingIntervalType: 'day' as const, billingIntervalValue: 30 };
  const hourBilling = { billingIntervalType: 'hour' as const, billingIntervalValue: 24 };

  it('computes day-based billing period end', () => {
    const start = new Date('2026-01-01T00:00:00Z');
    const end = getBillingPeriodEnd(dayBilling, start);

    expect(end.toISOString()).toBe('2026-01-31T00:00:00.000Z');
  });

  it('computes hour-based billing period end', () => {
    const start = new Date('2026-01-01T00:00:00Z');
    const end = getBillingPeriodEnd(hourBilling, start);

    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it('computes monthly billing period end using billing day of month', () => {
    const start = new Date('2026-01-15T12:00:00Z');
    const end = getBillingPeriodEnd(
      { billingIntervalType: 'month', billingIntervalValue: 1, billingDayOfMonth: 15 },
      start,
    );

    expect(end.getDate()).toBe(15);
    expect(end.getMonth()).toBe(1);
  });

  it('computes yearly billing period end', () => {
    const start = new Date('2026-03-15T10:30:00Z');
    const end = getBillingPeriodEnd({ billingIntervalType: 'year', billingIntervalValue: 1 }, start);

    expect(end.getFullYear()).toBe(2027);
    expect(end.getMonth()).toBe(2);
    expect(end.getDate()).toBe(15);
  });

  it('returns zero overlap when benefit window is outside charge period', () => {
    const periodStart = new Date('2026-02-01T00:00:00Z');
    const periodEnd = new Date('2026-03-01T00:00:00Z');
    const benefitStart = new Date('2026-01-01T00:00:00Z');
    const benefitEnd = new Date('2026-01-02T00:00:00Z');

    expect(calculateOverlapMs(periodStart, periodEnd, benefitStart, benefitEnd)).toBe(0);
  });

  it('prorates discount by overlap ratio', () => {
    const periodStart = new Date('2026-01-01T00:00:00Z');
    const periodEnd = new Date('2026-01-31T00:00:00Z');
    const benefitStart = new Date('2026-01-01T00:00:00Z');
    const benefitEnd = new Date('2026-01-02T00:00:00Z');

    expect(calculateProratedDiscount(126.39, periodStart, periodEnd, benefitStart, benefitEnd)).toBe(4.21);
  });

  it('returns zero prorated discount for invalid period', () => {
    const date = new Date('2026-01-01T00:00:00Z');

    expect(calculateProratedDiscount(100, date, date, date, new Date('2026-01-02T00:00:00Z'))).toBe(0);
  });

  it('returns billing period duration in milliseconds', () => {
    const start = new Date('2026-01-01T00:00:00Z');

    expect(getBillingPeriodDurationMs(dayBilling, start)).toBe(30 * 24 * 60 * 60 * 1000);
  });
});
