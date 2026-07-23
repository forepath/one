import { BillingIntervalType } from '../entities/service-plan.entity';

import { BillingScheduleService } from './billing-schedule.service';

describe('BillingScheduleService', () => {
  const service = new BillingScheduleService();

  it('calculates hourly schedule', () => {
    const now = new Date('2024-01-01T00:00:00Z');
    const result = service.calculateSchedule(BillingIntervalType.HOUR, 2, undefined, now);

    expect(result.currentPeriodEnd.getTime()).toBe(now.getTime() + 2 * 60 * 60 * 1000);
  });

  it('calculates day schedule', () => {
    const now = new Date('2024-01-01T00:00:00Z');
    const result = service.calculateSchedule(BillingIntervalType.DAY, 3, undefined, now);

    expect(result.currentPeriodEnd.getUTCDate()).toBe(4);
  });

  it('falls back to last day of month', () => {
    const now = new Date('2024-01-31T00:00:00Z');
    const result = service.calculateSchedule(BillingIntervalType.MONTH, 1, 31, now);

    expect(result.currentPeriodEnd.getUTCDate()).toBeGreaterThan(0);
  });

  it('calculates yearly schedule by calendar years', () => {
    const now = new Date('2024-03-15T10:30:00Z');
    const result = service.calculateSchedule(BillingIntervalType.YEAR, 1, undefined, now);

    expect(result.currentPeriodEnd.getUTCFullYear()).toBe(2025);
    expect(result.currentPeriodEnd.getUTCMonth()).toBe(2);
    expect(result.currentPeriodEnd.getUTCDate()).toBe(15);
    expect(result.nextBillingAt).toEqual(result.currentPeriodEnd);
  });

  it('aligns yearly schedule to billingDayOfMonth when set', () => {
    const now = new Date('2024-01-31T00:00:00Z');
    const result = service.calculateSchedule(BillingIntervalType.YEAR, 1, 31, now);

    expect(result.currentPeriodEnd.getUTCFullYear()).toBe(2025);
    expect(result.currentPeriodEnd.getUTCMonth()).toBe(0);
    expect(result.currentPeriodEnd.getUTCDate()).toBe(31);
  });

  it('supports multi-year interval values', () => {
    const now = new Date('2024-06-01T00:00:00Z');
    const result = service.calculateSchedule(BillingIntervalType.YEAR, 2, undefined, now);

    expect(result.currentPeriodEnd.getUTCFullYear()).toBe(2026);
  });
});
