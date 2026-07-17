import { EmailService } from '@forepath/shared/backend';
import { Injectable, Logger } from '@nestjs/common';

import { CustomerProfilesRepository } from '../repositories/customer-profiles.repository';
import { ServicePlansRepository } from '../repositories/service-plans.repository';
import { SubscriptionsRepository } from '../repositories/subscriptions.repository';

import { BillingEmailPublisher } from '../email/billing-email.publisher';

export interface RenewalReminderUnitPayload {
  subscriptionId: string;
  periodKey: string;
}

@Injectable()
export class SubscriptionRenewalReminderJobHandler {
  private readonly logger = new Logger(SubscriptionRenewalReminderJobHandler.name);
  private readonly reminderDays = parseInt(process.env.REMINDER_DAYS ?? '3', 10);
  private readonly batchSize = parseInt(process.env.REMINDER_SCHEDULER_BATCH_SIZE ?? '100', 10);

  constructor(
    private readonly subscriptionsRepository: SubscriptionsRepository,
    private readonly servicePlansRepository: ServicePlansRepository,
    private readonly customerProfilesRepository: CustomerProfilesRepository,
    private readonly emailService: EmailService,
    private readonly billingEmailPublisher: BillingEmailPublisher,
  ) {}

  isEmailEnabled(): boolean {
    return this.emailService.isEnabled();
  }

  async findUpcomingReminderUnits(): Promise<RenewalReminderUnitPayload[]> {
    const now = new Date();
    const upcomingSubscriptions = await this.subscriptionsRepository.findUpcomingRenewals(
      this.reminderDays,
      now,
      this.batchSize,
    );

    return upcomingSubscriptions.map((subscription) => ({
      subscriptionId: subscription.id,
      periodKey: `${subscription.id}:${subscription.currentPeriodEnd?.getTime() ?? 'none'}`,
    }));
  }

  async processReminder(payload: RenewalReminderUnitPayload): Promise<void> {
    const subscription = await this.subscriptionsRepository.findByIdOrThrow(payload.subscriptionId);
    const profile = await this.customerProfilesRepository.findByUserId(subscription.userId);
    const email = profile?.email;

    if (!email) {
      this.logger.debug(`No email found for user ${subscription.userId}, skipping reminder`);

      return;
    }

    const plan = await this.servicePlansRepository.findByIdOrThrow(subscription.planId);
    const renewalDate = subscription.nextBillingAt?.toLocaleDateString() ?? 'soon';

    await this.billingEmailPublisher.publishRenewalReminder(
      subscription,
      plan.name,
      email,
      profile.firstName?.trim() || 'Customer',
      renewalDate,
    );

    this.logger.log(`Enqueued renewal reminder for subscription ${subscription.id} to ${email}`);
  }
}
