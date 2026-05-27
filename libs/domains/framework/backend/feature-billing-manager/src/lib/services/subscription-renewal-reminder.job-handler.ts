import { EmailService } from '@forepath/shared/backend';
import { Injectable, Logger } from '@nestjs/common';

import { CustomerProfilesRepository } from '../repositories/customer-profiles.repository';
import { ServicePlansRepository } from '../repositories/service-plans.repository';
import { SubscriptionsRepository } from '../repositories/subscriptions.repository';

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
    const sent = await this.emailService.send({
      to: email,
      subject: `Upcoming subscription renewal: ${plan.name}`,
      text: `Dear ${profile.firstName ?? 'Customer'},\n\nYour subscription "${plan.name}" is scheduled for renewal on ${renewalDate}.\n\nIf you wish to cancel, please log in to your account before the renewal date.\n\nBest regards,\nThe Billing Team`,
      html: `<p>Dear ${profile.firstName ?? 'Customer'},</p><p>Your subscription "<strong>${plan.name}</strong>" is scheduled for renewal on <strong>${renewalDate}</strong>.</p><p>If you wish to cancel, please log in to your account before the renewal date.</p><p>Best regards,<br>The Billing Team</p>`,
    });

    if (sent) {
      this.logger.log(`Sent renewal reminder for subscription ${subscription.id} to ${email}`);
    }
  }
}
