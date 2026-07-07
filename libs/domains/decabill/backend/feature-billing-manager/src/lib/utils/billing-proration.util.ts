import { BillingIntervalType } from '../entities/service-plan.entity';
import type { ServicePlanEntity } from '../entities/service-plan.entity';
import type { BillingScheduleService } from '../services/billing-schedule.service';

export function calculateProratedAmount(
  plan: ServicePlanEntity,
  fullPeriodPrice: number,
  from: Date,
  until: Date,
  billingScheduleService: BillingScheduleService,
): number {
  if (until <= from) {
    return 0;
  }

  let remainingMs = until.getTime() - from.getTime();
  let cursor = new Date(from);
  let amount = 0;
  let iterations = 0;
  const maxIterations = 1000;

  while (remainingMs > 0 && iterations < maxIterations) {
    iterations += 1;

    const schedule = billingScheduleService.calculateSchedule(
      plan.billingIntervalType as BillingIntervalType,
      plan.billingIntervalValue,
      plan.billingDayOfMonth,
      cursor,
    );
    const cycleEnd = schedule.currentPeriodEnd;

    if (!cycleEnd || cycleEnd <= cursor) {
      amount += fullPeriodPrice;
      break;
    }

    const cycleMs = cycleEnd.getTime() - cursor.getTime();

    if (cycleMs <= 0) {
      break;
    }

    const segmentMs = Math.min(remainingMs, cycleMs);

    amount += fullPeriodPrice * (segmentMs / cycleMs);

    remainingMs -= segmentMs;
    cursor = cycleEnd;
  }

  return amount;
}
