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
});
