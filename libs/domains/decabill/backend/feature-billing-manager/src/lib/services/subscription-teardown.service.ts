import { Injectable, Logger } from '@nestjs/common';

import { SubscriptionStatus } from '../entities/subscription.entity';
import { OpenPositionsRepository } from '../repositories/open-positions.repository';
import { SubscriptionItemsRepository } from '../repositories/subscription-items.repository';
import { SubscriptionsRepository } from '../repositories/subscriptions.repository';

import { CloudflareDnsService } from './cloudflare-dns.service';
import { HostnameReservationService } from './hostname-reservation.service';
import { ProvisioningService } from './provisioning.service';

export interface TeardownOptions {
  withdrawn?: boolean;
  skipOpenPosition?: boolean;
  billUntil?: Date;
}

@Injectable()
export class SubscriptionTeardownService {
  private readonly logger = new Logger(SubscriptionTeardownService.name);

  constructor(
    private readonly subscriptionsRepository: SubscriptionsRepository,
    private readonly subscriptionItemsRepository: SubscriptionItemsRepository,
    private readonly provisioningService: ProvisioningService,
    private readonly openPositionsRepository: OpenPositionsRepository,
    private readonly hostnameReservationService: HostnameReservationService,
    private readonly cloudflareDnsService: CloudflareDnsService,
  ) {}

  async teardownImmediate(subscriptionId: string, options: TeardownOptions = {}): Promise<void> {
    const subscription = await this.subscriptionsRepository.findByIdOrThrow(subscriptionId);
    const items = await this.subscriptionItemsRepository.findBySubscription(subscription.id);

    this.logger.log(`Tearing down subscription ${subscription.id} with ${items.length} item(s)`);

    for (const item of items) {
      if (item.hostname) {
        try {
          await this.cloudflareDnsService.deleteRecord(item.hostname);
        } catch (error) {
          this.logger.warn(
            `Failed to remove DNS record for ${item.hostname} (subscription ${subscription.id}): ${(error as Error).message}`,
          );
        }

        try {
          await this.hostnameReservationService.releaseHostname(item.id);
        } catch (error) {
          this.logger.warn(`Failed to release hostname for item ${item.id}: ${(error as Error).message}`);
        }
      }

      if (item.providerReference && item.serviceType?.provider) {
        try {
          await this.provisioningService.deprovision(item.serviceType.provider, item.providerReference);
        } catch (error) {
          this.logger.warn(
            `Failed to deprovision resource ${item.providerReference} for subscription ${subscription.id}: ${(error as Error).message}`,
          );
        }
      }
    }

    const billUntil = options.billUntil ?? new Date();

    if (!options.skipOpenPosition) {
      try {
        await this.openPositionsRepository.create({
          subscriptionId: subscription.id,
          userId: subscription.userId,
          description: options.withdrawn
            ? `Subscription ${subscription.number} (withdrawn)`
            : `Subscription ${subscription.number}`,
          billUntil,
          skipIfNoBillableAmount: true,
        });
      } catch (error) {
        this.logger.warn(
          `Failed to record open position for subscription ${subscription.id}: ${(error as Error).message}`,
        );
      }
    }

    await this.subscriptionsRepository.update(subscription.id, {
      status: SubscriptionStatus.CANCELED,
      ...(options.withdrawn ? { withdrawnAt: billUntil } : {}),
    });
  }
}
