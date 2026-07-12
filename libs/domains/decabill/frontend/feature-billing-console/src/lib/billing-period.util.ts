import type { BillingIntervalType } from '@forepath/decabill/frontend/data-access-billing-console';

export interface PromotionBillingContext {
  billingIntervalType: BillingIntervalType;
  billingIntervalValue: number;
  billingDayOfMonth?: number | null;
}

function nextMonthlyDate(reference: Date, dayOfMonth: number): Date {
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

export function getBillingPeriodEnd(billing: PromotionBillingContext, periodStart: Date): Date {
  if (billing.billingIntervalType === 'hour') {
    return new Date(periodStart.getTime() + billing.billingIntervalValue * 60 * 60 * 1000);
  }

  if (billing.billingIntervalType === 'day') {
    const periodEnd = new Date(periodStart);

    periodEnd.setDate(periodEnd.getDate() + billing.billingIntervalValue);

    return periodEnd;
  }

  return nextMonthlyDate(periodStart, billing.billingDayOfMonth ?? 1);
}

export function getBillingPeriodDurationMs(billing: PromotionBillingContext, periodStart: Date): number {
  const periodEnd = getBillingPeriodEnd(billing, periodStart);

  return Math.max(0, periodEnd.getTime() - periodStart.getTime());
}

export function calculateOverlapMs(periodStart: Date, periodEnd: Date, benefitStart: Date, benefitEnd: Date): number {
  const overlapStart = Math.max(periodStart.getTime(), benefitStart.getTime());
  const overlapEnd = Math.min(periodEnd.getTime(), benefitEnd.getTime());

  return Math.max(0, overlapEnd - overlapStart);
}

export function calculateProratedDiscount(
  periodPrice: number,
  periodStart: Date,
  periodEnd: Date,
  benefitStart: Date,
  benefitEnd: Date,
): number {
  const periodMs = periodEnd.getTime() - periodStart.getTime();

  if (periodMs <= 0 || periodPrice <= 0) {
    return 0;
  }

  const overlapMs = calculateOverlapMs(periodStart, periodEnd, benefitStart, benefitEnd);

  return Math.round(periodPrice * (overlapMs / periodMs) * 100) / 100;
}
