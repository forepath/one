import { Injectable, Logger } from '@nestjs/common';

import { SubscriptionsRepository } from '../repositories/subscriptions.repository';

import { SubscriptionTeardownService } from './subscription-teardown.service';

@Injectable()
export class SubscriptionExpirationJobHandler {
  private readonly logger = new Logger(SubscriptionExpirationJobHandler.name);
  private readonly batchSize = parseInt(process.env.EXPIRATION_SCHEDULER_BATCH_SIZE ?? '100', 10);

  constructor(
    private readonly subscriptionsRepository: SubscriptionsRepository,
    private readonly subscriptionTeardownService: SubscriptionTeardownService,
  ) {}

  async findExpiredSubscriptionIds(): Promise<string[]> {
    const now = new Date();
    const expiredSubscriptions = await this.subscriptionsRepository.findDueForCancellation(now, this.batchSize);

    return expiredSubscriptions.map((subscription) => subscription.id);
  }

  async processSubscriptionCancellation(subscriptionId: string): Promise<void> {
    const subscription = await this.subscriptionsRepository.findByIdOrThrow(subscriptionId);
    const cancelEffectiveAt = subscription.cancelEffectiveAt ?? new Date();

    await this.subscriptionTeardownService.teardownImmediate(subscriptionId, {
      billUntil: cancelEffectiveAt,
    });

    this.logger.log(`Canceled subscription ${subscriptionId}`);
  }
}
