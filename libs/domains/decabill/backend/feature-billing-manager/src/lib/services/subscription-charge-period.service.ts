import { Injectable } from '@nestjs/common';

import type { ServicePlanEntity } from '../entities/service-plan.entity';
import type { SubscriptionEntity } from '../entities/subscription.entity';
import { InvoicesRepository } from '../repositories/invoices.repository';
import { SubscriptionItemsRepository } from '../repositories/subscription-items.repository';
import { calculateProratedAmount } from '../utils/billing-proration.util';
import { getEarliestProvisionedAt } from '../utils/provisioned-billing.util';

import { BillingScheduleService } from './billing-schedule.service';

export interface SubscriptionChargePeriod {
  baseAmount: number;
  periodStart: Date;
  periodEnd: Date;
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
    const subscriptionStart = subscription.currentPeriodStart ?? subscription.createdAt ?? now;
    const subscriptionEndOrToday =
      subscription.cancelEffectiveAt && subscription.cancelEffectiveAt < now ? subscription.cancelEffectiveAt : now;
    let effectiveUntil = billUntil;

    if (effectiveUntil > subscriptionEndOrToday) {
      effectiveUntil = subscriptionEndOrToday;
    }

    if (effectiveUntil <= subscriptionStart) {
      return null;
    }

    const latestInvoice = await this.invoicesRepository.findLatestBySubscription(subscription.id);
    let lastBillingAt: Date | undefined = latestInvoice?.createdAt;

    if (!lastBillingAt) {
      lastBillingAt = subscription.currentPeriodStart ?? subscription.createdAt;
    }

    if (!lastBillingAt) {
      return {
        baseAmount: fullPeriodPrice,
        periodStart: subscriptionStart,
        periodEnd: effectiveUntil,
      };
    }

    if (lastBillingAt < subscriptionStart) {
      lastBillingAt = subscriptionStart;
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

    return {
      baseAmount,
      periodStart: lastBillingAt,
      periodEnd: effectiveUntil,
    };
  }
}
