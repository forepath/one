import { Injectable, Logger } from '@nestjs/common';

import { SubscriptionsRepository } from '../repositories/subscriptions.repository';

import { SubscriptionTeardownService } from './subscription-teardown.service';

@Injectable()
export class SubscriptionWithdrawalJobHandler {
  private readonly logger = new Logger(SubscriptionWithdrawalJobHandler.name);
  private readonly batchSize = parseInt(process.env.WITHDRAWAL_SCHEDULER_BATCH_SIZE ?? '100', 10);

  constructor(
    private readonly subscriptionsRepository: SubscriptionsRepository,
    private readonly subscriptionTeardownService: SubscriptionTeardownService,
  ) {}

  async findPendingWithdrawalIds(): Promise<string[]> {
    const now = new Date();
    const pending = await this.subscriptionsRepository.findDueForWithdrawal(now, this.batchSize);

    return pending.map((subscription) => subscription.id);
  }

  async processSubscriptionWithdrawal(subscriptionId: string): Promise<void> {
    await this.subscriptionTeardownService.processWithdrawal(subscriptionId);

    this.logger.log(`Withdrew subscription ${subscriptionId}`);
  }
}
