import type { InvoiceEntity } from '../entities/invoice.entity';
import { BillingIntervalType } from '../entities/service-plan.entity';
import type { ServicePlanEntity } from '../entities/service-plan.entity';
import type { SubscriptionEntity } from '../entities/subscription.entity';

export interface InvoicingPeriod {
  periodStart: Date;
  periodEnd: Date;
}

export function resolveInvoicingPeriod(
  invoice: Pick<InvoiceEntity, 'issuedAt' | 'createdAt'>,
  subscription?: Pick<SubscriptionEntity, 'currentPeriodStart' | 'currentPeriodEnd' | 'createdAt'> | null,
  plan?: Pick<ServicePlanEntity, 'billingIntervalType' | 'billingIntervalValue' | 'billingDayOfMonth'> | null,
): InvoicingPeriod {
  const periodEnd = invoice.issuedAt ?? invoice.createdAt;

  if (subscription?.currentPeriodStart && subscription?.currentPeriodEnd) {
    return normalizePeriod({
      periodStart: subscription.currentPeriodStart,
      periodEnd: subscription.currentPeriodEnd,
    });
  }

  if (plan) {
    return normalizePeriod({
      periodStart: subtractBillingInterval(periodEnd, plan),
      periodEnd,
    });
  }

  const periodStart = subscription?.currentPeriodStart ?? subscription?.createdAt ?? periodEnd;

  return normalizePeriod({ periodStart, periodEnd });
}

function subtractBillingInterval(
  end: Date,
  plan: Pick<ServicePlanEntity, 'billingIntervalType' | 'billingIntervalValue' | 'billingDayOfMonth'>,
): Date {
  const start = new Date(end);

  if (plan.billingIntervalType === BillingIntervalType.HOUR) {
    start.setTime(start.getTime() - plan.billingIntervalValue * 60 * 60 * 1000);

    return start;
  }

  if (plan.billingIntervalType === BillingIntervalType.DAY) {
    start.setDate(start.getDate() - plan.billingIntervalValue);

    return start;
  }

  start.setMonth(start.getMonth() - plan.billingIntervalValue);

  return start;
}

function normalizePeriod(period: InvoicingPeriod): InvoicingPeriod {
  if (period.periodStart.getTime() <= period.periodEnd.getTime()) {
    return period;
  }

  return {
    periodStart: period.periodEnd,
    periodEnd: period.periodStart,
  };
}
