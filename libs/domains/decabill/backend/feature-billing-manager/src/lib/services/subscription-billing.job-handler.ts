import { Injectable, Logger } from '@nestjs/common';

import { OpenPositionsRepository } from '../repositories/open-positions.repository';
import { ServicePlansRepository } from '../repositories/service-plans.repository';
import { SubscriptionsRepository } from '../repositories/subscriptions.repository';

import { SubscriptionPeriodChargeService } from './subscription-period-charge.service';

@Injectable()
export class SubscriptionBillingJobHandler {
  private readonly logger = new Logger(SubscriptionBillingJobHandler.name);
  private readonly batchSize = parseInt(process.env.BILLING_SCHEDULER_BATCH_SIZE ?? '100', 10);

  constructor(
    private readonly subscriptionsRepository: SubscriptionsRepository,
    private readonly servicePlansRepository: ServicePlansRepository,
    private readonly openPositionsRepository: OpenPositionsRepository,
    private readonly subscriptionPeriodChargeService: SubscriptionPeriodChargeService,
  ) {}

  async findDueSubscriptionIds(): Promise<string[]> {
    const now = new Date();
    const dueSubscriptions = await this.subscriptionsRepository.findDueForBilling(now, this.batchSize);

    return dueSubscriptions.map((subscription) => subscription.id);
  }

  async processSubscription(subscriptionId: string): Promise<void> {
    if (await this.openPositionsRepository.hasUnbilledForSubscription(subscriptionId)) {
      this.logger.debug(`Subscription ${subscriptionId} already has an unbilled open position, skipping`);

      return;
    }

    const subscription = await this.subscriptionsRepository.findByIdOrThrow(subscriptionId);
    const plan = await this.servicePlansRepository.findByIdOrThrow(subscription.planId);

    await this.subscriptionPeriodChargeService.processDueBilling(subscription, plan);
  }
}
