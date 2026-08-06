import { Injectable } from '@nestjs/common';

import type { ServicePlanEntity } from '../entities/service-plan.entity';
import type { SubscriptionEntity } from '../entities/subscription.entity';
import { InvoicesRepository } from '../repositories/invoices.repository';
import { SubscriptionItemsRepository } from '../repositories/subscription-items.repository';
import { calculateProratedAmount } from '../utils/billing-proration.util';
import { getEarliestProvisionedAt } from '../utils/provisioned-billing.util';

import { BillingScheduleService } from './billing-schedule.service';
import { subtractBillingInterval } from './invoicing-period.util';

export interface SubscriptionChargePeriod {
  baseAmount: number;
  /** Floor used for subscription base proration (often last invoice createdAt). */
  periodStart: Date;
  periodEnd: Date;
  /**
   * Floor for meter aggregation. Schedule-aligned when the arrear tick already rolled
   * the subscription forward, so lagged invoice.createdAt does not drop collector samples.
   */
  meterPeriodStart: Date;
}

@Injectable()
export class SubscriptionChargePeriodService {
  constructor(
    private readonly invoicesRepository: InvoicesRepository,
    private readonly subscriptionItemsRepository: SubscriptionItemsRepository,
    private readonly billingScheduleService: BillingScheduleService,
  ) {}

  async resolveChargePeriod(
    subscription: SubscriptionEntity,
    plan: ServicePlanEntity,
    fullPeriodPrice: number,
    billUntil: Date,
    now: Date = new Date(),
  ): Promise<SubscriptionChargePeriod | null> {
    const subscriptionEndOrToday =
      subscription.cancelEffectiveAt && subscription.cancelEffectiveAt < now ? subscription.cancelEffectiveAt : now;
    let effectiveUntil = billUntil;

    if (effectiveUntil > subscriptionEndOrToday) {
      effectiveUntil = subscriptionEndOrToday;
    }

    const latestInvoice = await this.invoicesRepository.findLatestBySubscription(subscription.id);
    // After an arrear billing tick the schedule is already rolled forward, so
    // currentPeriodStart can sit at/after billUntil. Prefer last invoice / createdAt
    // as the charge floor so the closed period remaining on the open position still bills.
    const rolledForward = subscription.currentPeriodStart != null && subscription.currentPeriodStart >= billUntil;
    const periodFloor = rolledForward
      ? (latestInvoice?.createdAt ?? subscription.createdAt ?? now)
      : (subscription.currentPeriodStart ?? subscription.createdAt ?? now);

    if (effectiveUntil <= periodFloor) {
      return null;
    }

    let lastBillingAt: Date | undefined = latestInvoice?.createdAt;

    if (!lastBillingAt) {
      lastBillingAt = rolledForward
        ? (subscription.createdAt ?? periodFloor)
        : (subscription.currentPeriodStart ?? subscription.createdAt);
    }

    if (!lastBillingAt) {
      const meterPeriodStart = this.resolveMeterPeriodStart({
        subscription,
        plan,
        billUntil: effectiveUntil,
        rolledForward,
        fallbackStart: periodFloor,
        hasPriorInvoice: false,
      });

      return {
        baseAmount: fullPeriodPrice,
        periodStart: periodFloor,
        periodEnd: effectiveUntil,
        meterPeriodStart,
      };
    }

    if (lastBillingAt < periodFloor) {
      lastBillingAt = periodFloor;
    }

    if (subscription.withdrawnAt) {
      const items = await this.subscriptionItemsRepository.findBySubscription(subscription.id);
      const provisionedFrom = getEarliestProvisionedAt(items);

      if (!provisionedFrom) {
        return null;
      }

      if (!lastBillingAt || lastBillingAt < provisionedFrom) {
        lastBillingAt = provisionedFrom;
      }
    }

    if (effectiveUntil <= lastBillingAt) {
      return null;
    }

    const baseAmount = calculateProratedAmount(
      plan,
      fullPeriodPrice,
      lastBillingAt,
      effectiveUntil,
      this.billingScheduleService,
    );
    const meterPeriodStart = this.resolveMeterPeriodStart({
      subscription,
      plan,
      billUntil: effectiveUntil,
      rolledForward,
      fallbackStart: lastBillingAt,
      hasPriorInvoice: latestInvoice != null,
    });

    return {
      baseAmount,
      periodStart: lastBillingAt,
      periodEnd: effectiveUntil,
      meterPeriodStart,
    };
  }

  private resolveMeterPeriodStart(params: {
    subscription: SubscriptionEntity;
    plan: ServicePlanEntity;
    billUntil: Date;
    rolledForward: boolean;
    fallbackStart: Date;
    hasPriorInvoice: boolean;
  }): Date {
    const createdAt = params.subscription.createdAt ?? params.fallbackStart;

    if (params.rolledForward && params.hasPriorInvoice) {
      const alignedStart = subtractBillingInterval(params.billUntil, params.plan);

      return alignedStart.getTime() > createdAt.getTime() ? alignedStart : createdAt;
    }

    // Direct createInvoice / in-period charges: do not let a lagged invoice.createdAt
    // push the meter floor past the open schedule period start.
    const scheduleStart = params.subscription.currentPeriodStart;

    if (
      params.hasPriorInvoice &&
      scheduleStart &&
      scheduleStart.getTime() < params.billUntil.getTime() &&
      scheduleStart.getTime() < params.fallbackStart.getTime()
    ) {
      return scheduleStart.getTime() > createdAt.getTime() ? scheduleStart : createdAt;
    }

    return params.fallbackStart;
  }
}
