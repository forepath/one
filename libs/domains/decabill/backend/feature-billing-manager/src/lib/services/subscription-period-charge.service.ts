import { Injectable, Logger } from '@nestjs/common';

import { BillingIntervalType, type ServicePlanEntity } from '../entities/service-plan.entity';
import type { SubscriptionEntity } from '../entities/subscription.entity';
import { BillingNotificationPublisher } from '../notifications/billing-notification.publisher';
import { OpenPositionsRepository } from '../repositories/open-positions.repository';
import { SubscriptionsRepository } from '../repositories/subscriptions.repository';

import { BillingScheduleService } from './billing-schedule.service';
import { MeterBillingService } from './meter-billing.service';

@Injectable()
export class SubscriptionPeriodChargeService {
  private readonly logger = new Logger(SubscriptionPeriodChargeService.name);

  constructor(
    private readonly openPositionsRepository: OpenPositionsRepository,
    private readonly subscriptionsRepository: SubscriptionsRepository,
    private readonly billingScheduleService: BillingScheduleService,
    private readonly billingNotificationPublisher: BillingNotificationPublisher,
    private readonly meterBillingService: MeterBillingService,
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

    const meterCharges = await this.resolveMeterCharges(subscription, plan, periodStart, periodEnd);
    this.billingNotificationPublisher.publishPeriodCharged(
      subscription,
      plan,
      billUntil,
      periodStart,
      periodEnd,
      meterCharges,
    );
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
    // Arrear: advance from the closed period end so late ticks do not open a gap that drops meter samples.
    const scheduleAnchor = billInAdvance ? now : (subscription.nextBillingAt ?? now);
    const schedule = this.billingScheduleService.calculateSchedule(
      plan.billingIntervalType as BillingIntervalType,
      plan.billingIntervalValue,
      plan.billingDayOfMonth,
      scheduleAnchor,
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

    const meterCharges = await this.resolveMeterCharges(subscription, plan, periodStart, periodEnd);
    this.billingNotificationPublisher.publishPeriodCharged(
      subscription,
      plan,
      billUntil,
      periodStart,
      periodEnd,
      meterCharges,
    );

    const updated = await this.subscriptionsRepository.update(subscription.id, {
      currentPeriodStart: schedule.currentPeriodStart,
      currentPeriodEnd: schedule.currentPeriodEnd,
      nextBillingAt: schedule.nextBillingAt,
    });

    this.billingNotificationPublisher.publishSubscription('subscription.updated', updated, plan);
    this.logger.log(`Billed subscription ${subscription.id}, next billing at ${schedule.nextBillingAt.toISOString()}`);

    return updated;
  }

  private async resolveMeterCharges(
    subscription: SubscriptionEntity,
    plan: Pick<ServicePlanEntity, 'billInAdvance' | 'billingIntervalType'> & Partial<ServicePlanEntity>,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<Array<Record<string, unknown>>> {
    if (plan.billInAdvance === true) {
      return [];
    }

    const lines = await this.meterBillingService.buildMeterChargeLines({
      subscription,
      plan: plan as ServicePlanEntity,
      periodStart,
      periodEnd,
    });

    return lines.map((line) => ({
      meterId: line.meterId,
      attachmentType: line.attachmentType,
      addonId: line.addonId ?? null,
      description: line.description,
      aggregatedValue: line.aggregatedValue,
      effectiveUnitPriceNet: line.effectiveUnitPriceNet,
      unitPriceNet: line.unitPriceNet,
    }));
  }
}
