import { Injectable, Logger } from '@nestjs/common';

import { BillingIntervalType } from '../entities/service-plan.entity';
import { OpenPositionsRepository } from '../repositories/open-positions.repository';
import { ServicePlansRepository } from '../repositories/service-plans.repository';
import { SubscriptionsRepository } from '../repositories/subscriptions.repository';

import { BillingScheduleService } from './billing-schedule.service';

@Injectable()
export class SubscriptionBillingJobHandler {
  private readonly logger = new Logger(SubscriptionBillingJobHandler.name);
  private readonly batchSize = parseInt(process.env.BILLING_SCHEDULER_BATCH_SIZE ?? '100', 10);

  constructor(
    private readonly subscriptionsRepository: SubscriptionsRepository,
    private readonly servicePlansRepository: ServicePlansRepository,
    private readonly billingScheduleService: BillingScheduleService,
    private readonly openPositionsRepository: OpenPositionsRepository,
  ) {}

  async findDueSubscriptionIds(): Promise<string[]> {
    const now = new Date();
    const dueSubscriptions = await this.subscriptionsRepository.findDueForBilling(now, this.batchSize);

    return dueSubscriptions.map((subscription) => subscription.id);
  }

  async processSubscription(subscriptionId: string): Promise<void> {
    const subscription = await this.subscriptionsRepository.findByIdOrThrow(subscriptionId);
    const plan = await this.servicePlansRepository.findByIdOrThrow(subscription.planId);

    await this.openPositionsRepository.create({
      subscriptionId: subscription.id,
      userId: subscription.userId,
      description: `Subscription ${subscription.number}`,
      billUntil: subscription.nextBillingAt ?? new Date(),
      skipIfNoBillableAmount: true,
    });

    const schedule = this.billingScheduleService.calculateSchedule(
      plan.billingIntervalType as BillingIntervalType,
      plan.billingIntervalValue,
      plan.billingDayOfMonth,
    );

    await this.subscriptionsRepository.update(subscription.id, {
      currentPeriodStart: schedule.currentPeriodStart,
      currentPeriodEnd: schedule.currentPeriodEnd,
      nextBillingAt: schedule.nextBillingAt,
    });

    this.logger.log(`Billed subscription ${subscription.id}, next billing at ${schedule.nextBillingAt.toISOString()}`);
  }
}
