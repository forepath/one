import { Injectable } from '@nestjs/common';

import { BillingIntervalType } from '../entities/service-plan.entity';

export interface BillingSchedule {
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  nextBillingAt: Date;
}

@Injectable()
export class BillingScheduleService {
  calculateSchedule(
    intervalType: BillingIntervalType,
    intervalValue: number,
    billingDayOfMonth: number | undefined,
    now: Date = new Date(),
  ): BillingSchedule {
    const periodStart = new Date(now);
    let periodEnd: Date;

    if (intervalType === BillingIntervalType.HOUR) {
      periodEnd = new Date(periodStart.getTime() + intervalValue * 60 * 60 * 1000);
    } else if (intervalType === BillingIntervalType.DAY) {
      periodEnd = new Date(periodStart);
      periodEnd.setDate(periodEnd.getDate() + intervalValue);
    } else {
      const targetDay = billingDayOfMonth ?? 1;

      periodEnd = this.nextMonthlyDate(periodStart, targetDay);
    }

    return {
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      nextBillingAt: periodEnd,
    };
  }

  private nextMonthlyDate(reference: Date, dayOfMonth: number): Date {
    const year = reference.getFullYear();
    const month = reference.getMonth();
    const nextMonthDate = new Date(year, month + 1, 1, reference.getHours(), reference.getMinutes(), 0, 0);
    const daysInMonth = new Date(nextMonthDate.getFullYear(), nextMonthDate.getMonth() + 1, 0).getDate();
    const safeDay = Math.min(Math.max(dayOfMonth, 1), daysInMonth);

    return new Date(
      nextMonthDate.getFullYear(),
      nextMonthDate.getMonth(),
      safeDay,
      reference.getHours(),
      reference.getMinutes(),
      0,
      0,
    );
  }
}
