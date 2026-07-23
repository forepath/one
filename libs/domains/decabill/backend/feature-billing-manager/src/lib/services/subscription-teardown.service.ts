import { Injectable, Logger } from '@nestjs/common';

import { SubscriptionStatus } from '../entities/subscription.entity';
import { BillingEmailPublisher } from '../email/billing-email.publisher';
import { OpenPositionsRepository } from '../repositories/open-positions.repository';
import { ServicePlansRepository } from '../repositories/service-plans.repository';
import { SubscriptionItemsRepository } from '../repositories/subscription-items.repository';
import { SubscriptionsRepository } from '../repositories/subscriptions.repository';
import { getProvisioningCredentials } from '../utils/provider-env-defaults.utils';

import { BillingNotificationPublisher } from '../notifications/billing-notification.publisher';
import { CloudflareDnsService } from './cloudflare-dns.service';
import { HostnameReservationService } from './hostname-reservation.service';
import { ProvisioningService } from './provisioning.service';
import { WithdrawalRefundService } from './withdrawal-refund.service';

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
    private readonly servicePlansRepository: ServicePlansRepository,
    private readonly provisioningService: ProvisioningService,
    private readonly openPositionsRepository: OpenPositionsRepository,
    private readonly hostnameReservationService: HostnameReservationService,
    private readonly cloudflareDnsService: CloudflareDnsService,
    private readonly withdrawalRefundService: WithdrawalRefundService,
    private readonly billingNotificationPublisher: BillingNotificationPublisher,
    private readonly billingEmailPublisher: BillingEmailPublisher,
  ) {}

  /**
   * Completes a queued statutory withdrawal: applies the prorated refund when the
   * subscription was provisioned within the withdrawal period, then tears down the
   * instance. The withdrawal timestamp and phase are read from the subscription so the
   * refund proration matches the moment the customer withdrew, not when the job runs.
   */
  async processWithdrawal(subscriptionId: string): Promise<void> {
    const subscription = await this.subscriptionsRepository.findByIdOrThrow(subscriptionId);
    const plan = await this.servicePlansRepository.findByIdOrThrow(subscription.planId);
    const withdrawnAt = subscription.withdrawnAt ?? new Date();
    const billInAdvance = plan.billInAdvance === true;

    if (billInAdvance) {
      const unbilled = await this.openPositionsRepository.findUnbilledBySubscription(subscription.id);

      if (unbilled.length > 0) {
        // Case B (also covers unprovisioned advance): shrink prepaid debt to the used window.
        // Prefer this over crediting an older invoice from a prior period.
        await this.openPositionsRepository.updateUnbilledBillUntil(subscription.id, withdrawnAt);
      } else if (subscription.withdrawPhase === 'withdrawal_period') {
        // Case A: current period already invoiced — partial credit on the billable invoice.
        await this.withdrawalRefundService.applyProvisionedWithdrawalRefund(subscription, withdrawnAt);
      }
    } else if (subscription.withdrawPhase === 'withdrawal_period') {
      await this.withdrawalRefundService.applyProvisionedWithdrawalRefund(subscription, withdrawnAt);
    }

    await this.teardownImmediate(subscriptionId, {
      withdrawn: true,
      billUntil: withdrawnAt,
      skipOpenPosition:
        subscription.withdrawPhase === 'unprovisioned' ||
        (billInAdvance && subscription.withdrawPhase === 'withdrawal_period'),
    });
  }

  async teardownImmediate(subscriptionId: string, options: TeardownOptions = {}): Promise<void> {
    const subscription = await this.subscriptionsRepository.findByIdOrThrow(subscriptionId);
    const plan = await this.servicePlansRepository.findByIdOrThrow(subscription.planId);
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
          const credentials = getProvisioningCredentials(item.serviceType.provider, item.serviceType.providerDefaults);
          await this.provisioningService.deprovision(item.serviceType.provider, item.providerReference, credentials);
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

    const canceled = await this.subscriptionsRepository.update(subscription.id, {
      status: SubscriptionStatus.CANCELED,
      ...(options.withdrawn ? { withdrawnAt: billUntil } : {}),
    });

    this.billingNotificationPublisher.publishSubscription('subscription.canceled', canceled, plan);

    if (options.withdrawn) {
      await this.billingEmailPublisher.publishSubscriptionWithdrawn(canceled, plan.name);
    } else {
      await this.billingEmailPublisher.publishSubscriptionCanceled(canceled, plan.name);
    }
  }
}
