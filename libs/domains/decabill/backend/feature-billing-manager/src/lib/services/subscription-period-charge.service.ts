import { Injectable, Logger } from '@nestjs/common';

import { BillingIntervalType, type ServicePlanEntity } from '../entities/service-plan.entity';
import type { SubscriptionEntity } from '../entities/subscription.entity';
import { BillingNotificationPublisher } from '../notifications/billing-notification.publisher';
import { OpenPositionsRepository } from '../repositories/open-positions.repository';
import { SubscriptionsRepository } from '../repositories/subscriptions.repository';

import { BillingScheduleService } from './billing-schedule.service';

@Injectable()
export class SubscriptionPeriodChargeService {
  private readonly logger = new Logger(SubscriptionPeriodChargeService.name);

  constructor(
    private readonly openPositionsRepository: OpenPositionsRepository,
    private readonly subscriptionsRepository: SubscriptionsRepository,
    private readonly billingScheduleService: BillingScheduleService,
    private readonly billingNotificationPublisher: BillingNotificationPublisher,
  ) {}

  /**
   * Records an open position for the given bill-until instant without advancing the schedule.
   * Used for the initial advance charge at subscribe / backorder fulfillment.
   */
  async recordOpenPositionForPeriod(
    subscription: SubscriptionEntity,
    plan: Pick<ServicePlanEntity, 'billInAdvance' | 'billingIntervalType'>,
    billUntil: Date,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<void> {
    await this.openPositionsRepository.create({
      subscriptionId: subscription.id,
      userId: subscription.userId,
      description: `Subscription ${subscription.number}`,
      billUntil,
      skipIfNoBillableAmount: true,
    });

    this.billingNotificationPublisher.publishPeriodCharged(subscription, plan, billUntil, periodStart, periodEnd);
    this.logger.log(`Recorded open position for subscription ${subscription.id} until ${billUntil.toISOString()}`);
  }

  /**
   * Due billing tick: create debt then advance the subscription schedule.
   * Arrear: debt covers the period that just ended (billUntil = previous nextBillingAt).
   * Advance: debt covers the upcoming period (billUntil = new schedule period end).
   */
  async processDueBilling(subscription: SubscriptionEntity, plan: ServicePlanEntity): Promise<SubscriptionEntity> {
    const now = new Date();
    const billInAdvance = plan.billInAdvance === true;
    const schedule = this.billingScheduleService.calculateSchedule(
      plan.billingIntervalType as BillingIntervalType,
      plan.billingIntervalValue,
      plan.billingDayOfMonth,
      now,
    );

    const billUntil = billInAdvance ? schedule.currentPeriodEnd : (subscription.nextBillingAt ?? now);
    const periodStart = billInAdvance
      ? schedule.currentPeriodStart
      : (subscription.currentPeriodStart ?? subscription.createdAt);
    const periodEnd = billInAdvance ? schedule.currentPeriodEnd : (subscription.nextBillingAt ?? now);

    await this.openPositionsRepository.create({
      subscriptionId: subscription.id,
      userId: subscription.userId,
      description: `Subscription ${subscription.number}`,
      billUntil,
      skipIfNoBillableAmount: true,
    });

    this.billingNotificationPublisher.publishPeriodCharged(subscription, plan, billUntil, periodStart, periodEnd);

    const updated = await this.subscriptionsRepository.update(subscription.id, {
      currentPeriodStart: schedule.currentPeriodStart,
      currentPeriodEnd: schedule.currentPeriodEnd,
      nextBillingAt: schedule.nextBillingAt,
    });

    this.billingNotificationPublisher.publishSubscription('subscription.updated', updated, plan);
    this.logger.log(`Billed subscription ${subscription.id}, next billing at ${schedule.nextBillingAt.toISOString()}`);

    return updated;
  }
}
