import { BillingIntervalType } from '../entities/service-plan.entity';
import { BillingScheduleService } from '../services/billing-schedule.service';

import { calculateProratedAmount } from './billing-proration.util';

describe('calculateProratedAmount', () => {
  const billingScheduleService = new BillingScheduleService();
  const dayPlan = {
    billingIntervalType: BillingIntervalType.DAY,
    billingIntervalValue: 1,
    billingDayOfMonth: undefined,
  };

  it('returns zero when until is before from', () => {
    const amount = calculateProratedAmount(
      dayPlan as never,
      10,
      new Date('2024-01-10'),
      new Date('2024-01-01'),
      billingScheduleService,
    );

    expect(amount).toBe(0);
  });

  it('prorates remaining days in a daily plan', () => {
    const from = new Date('2024-01-01T00:00:00Z');
    const until = new Date('2024-01-11T00:00:00Z');
    const amount = calculateProratedAmount(dayPlan as never, 10, from, until, billingScheduleService);

    expect(amount).toBe(100);
  });

  it('prorates partial day segment', () => {
    const from = new Date('2024-01-01T00:00:00Z');
    const until = new Date('2024-01-01T12:00:00Z');
    const amount = calculateProratedAmount(dayPlan as never, 10, from, until, billingScheduleService);

    expect(amount).toBe(5);
  });
});
