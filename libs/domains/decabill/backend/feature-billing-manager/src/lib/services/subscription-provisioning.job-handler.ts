import { Injectable, Logger } from '@nestjs/common';

import { SubscriptionItemsRepository } from '../repositories/subscription-items.repository';

import { SubscriptionService } from './subscription.service';

@Injectable()
export class SubscriptionProvisioningJobHandler {
  private readonly logger = new Logger(SubscriptionProvisioningJobHandler.name);
  private readonly batchSize = parseInt(process.env.PROVISIONING_SCHEDULER_BATCH_SIZE ?? '100', 10);

  constructor(
    private readonly subscriptionItemsRepository: SubscriptionItemsRepository,
    private readonly subscriptionService: SubscriptionService,
  ) {}

  async findPendingProvisioningItemIds(): Promise<string[]> {
    return await this.subscriptionItemsRepository.findPendingProvisioningIds(this.batchSize);
  }

  async processItemProvisioning(itemId: string): Promise<void> {
    await this.subscriptionService.provisionSubscriptionItem(itemId);

    this.logger.log(`Processed provisioning for subscription item ${itemId}`);
  }
}
