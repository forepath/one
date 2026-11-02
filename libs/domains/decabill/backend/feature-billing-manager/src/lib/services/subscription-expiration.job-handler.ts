import { Injectable, Logger } from '@nestjs/common';

import {
  isLoadweaverItem,
  loadweaverTeardownNotBefore,
  resolveLoadweaverTeardownGraceDays,
} from '../contributors/loadweaver/loadweaver.utils';
import { SubscriptionItemsRepository } from '../repositories/subscription-items.repository';
import { SubscriptionsRepository } from '../repositories/subscriptions.repository';
import { ServicePlansRepository } from '../repositories/service-plans.repository';

import { SubscriptionTeardownService } from './subscription-teardown.service';

@Injectable()
export class SubscriptionExpirationJobHandler {
  private readonly logger = new Logger(SubscriptionExpirationJobHandler.name);
  private readonly batchSize = parseInt(process.env.EXPIRATION_SCHEDULER_BATCH_SIZE ?? '100', 10);

  constructor(
    private readonly subscriptionsRepository: SubscriptionsRepository,
    private readonly servicePlansRepository: ServicePlansRepository,
    private readonly subscriptionTeardownService: SubscriptionTeardownService,
    private readonly subscriptionItemsRepository: SubscriptionItemsRepository,
  ) {}

  async findExpiredSubscriptionIds(): Promise<string[]> {
    const now = new Date();
    const expiredSubscriptions = await this.subscriptionsRepository.findDueForCancellation(now, this.batchSize);

    return expiredSubscriptions.map((subscription) => subscription.id);
  }

  async processSubscriptionCancellation(subscriptionId: string, now: Date = new Date()): Promise<void> {
    const subscription = await this.subscriptionsRepository.findByIdOrThrow(subscriptionId);
    const plan = await this.servicePlansRepository.findByIdOrThrow(subscription.planId);
    const cancelEffectiveAt = subscription.cancelEffectiveAt ?? new Date();
    const items = (await this.subscriptionItemsRepository.findBySubscription(subscription.id)) ?? [];

    // Data-safe teardown (Loadweaver plan, section 4): a cancelled Loadweaver cluster keeps running for a grace
    // period after the effective date (not billed) so the customer can run a final backup to their external target
    // and export; only then is the Decabill-provisioned server deleted.
    // `teardownNotBefore` is stored at cancellation (the queue query filters on it); the computed value covers
    // cancellations recorded before the column existed.
    if (subscription.teardownNotBefore || items.some((item) => isLoadweaverItem(item))) {
      const notBefore = subscription.teardownNotBefore
        ? new Date(subscription.teardownNotBefore)
        : loadweaverTeardownNotBefore(new Date(cancelEffectiveAt), resolveLoadweaverTeardownGraceDays());

      if (now < notBefore) {
        this.logger.log(
          `Subscription ${subscriptionId} runs a Loadweaver cluster; teardown deferred until ${notBefore.toISOString()} (grace period)`,
        );

        return;
      }
    }

    await this.subscriptionTeardownService.teardownImmediate(subscriptionId, {
      billUntil: cancelEffectiveAt,
      // Advance periods were already charged at period start; avoid a second open position.
      skipOpenPosition: plan.billInAdvance === true,
    });

    this.logger.log(`Canceled subscription ${subscriptionId}`);
  }
}
