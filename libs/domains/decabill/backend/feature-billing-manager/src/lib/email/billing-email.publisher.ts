import {
  EmailNotificationDispatcherService,
  getTenantIdOrDefault,
  type EmailAttachmentRef,
} from '@forepath/shared/backend';
import { Injectable, Logger } from '@nestjs/common';
import { UsersRepository } from '@forepath/identity/backend';

import type { CustomerProfileEntity } from '../entities/customer-profile.entity';
import type { InvoiceEntity } from '../entities/invoice.entity';
import type { OfferEntity } from '../offers/entities/offer.entity';
import type { SubscriptionEntity } from '../entities/subscription.entity';
import { CustomerProfilesRepository } from '../repositories/customer-profiles.repository';

@Injectable()
export class BillingEmailPublisher {
  private readonly logger = new Logger(BillingEmailPublisher.name);

  constructor(
    private readonly emailDispatcher: EmailNotificationDispatcherService,
    private readonly customerProfilesRepository: CustomerProfilesRepository,
    private readonly usersRepository: UsersRepository,
  ) {}

  async publishInvoiceIssued(invoice: InvoiceEntity, pdfStorageKey: string): Promise<void> {
    if (!invoice.invoiceNumber) {
      this.logger.debug(`Invoice ${invoice.id} has no invoice number, skipping invoice email`);

      return;
    }

    const profile = await this.customerProfilesRepository.findByUserId(invoice.userId);
    const to = await this.resolveRecipientEmail(invoice.userId, profile);

    if (!to) {
      this.logger.warn(`No billing email found for user ${invoice.userId}, skipping invoice email`);

      return;
    }

    const dueDateLabel = this.formatDueDate(invoice.dueDate);
    const attachments: EmailAttachmentRef[] = [{ storageKey: pdfStorageKey, filename: `${invoice.invoiceNumber}.pdf` }];

    if (invoice.timeReportStorageKey) {
      attachments.push({
        storageKey: invoice.timeReportStorageKey,
        filename: `time-report-${invoice.invoiceNumber}.pdf`,
      });
    }

    await this.emailDispatcher.publish({
      eventType: 'invoice.issued',
      scopeKey: getTenantIdOrDefault(),
      to,
      templateKey: 'invoice-issued',
      templateContext: {
        recipientName: this.greeting(profile),
        invoiceNumber: invoice.invoiceNumber,
        amountLabel: this.formatAmount(Number(invoice.totalGross), invoice.currency),
        ...(dueDateLabel ? { dueDateLabel } : {}),
      },
      attachments,
    });
  }

  async publishOfferArchived(offer: OfferEntity, pdfStorageKey: string): Promise<void> {
    if (!offer.offerNumber) {
      this.logger.debug(`Offer ${offer.id} has no offer number, skipping offer email`);

      return;
    }

    const profile = await this.customerProfilesRepository.findByUserId(offer.userId);
    const to = await this.resolveRecipientEmail(offer.userId, profile);

    if (!to) {
      this.logger.warn(`No billing email found for user ${offer.userId}, skipping offer email`);

      return;
    }

    const expiresAtLabel = offer.expiresAt ? this.formatDueDate(offer.expiresAt) : undefined;

    await this.emailDispatcher.publish({
      eventType: 'offer.archived',
      scopeKey: getTenantIdOrDefault(),
      to,
      templateKey: 'offer-archived',
      templateContext: {
        recipientName: this.greeting(profile),
        offerNumber: offer.offerNumber,
        amountLabel: this.formatAmount(Number(offer.totalGross), offer.currency),
        ...(expiresAtLabel ? { expiresAtLabel } : {}),
      },
      attachments: [{ storageKey: pdfStorageKey, filename: `${offer.offerNumber}.pdf` }],
    });
  }

  async publishOfferAcceptedConfirmation(offer: OfferEntity): Promise<void> {
    if (!offer.offerNumber) {
      return;
    }

    const profile = await this.customerProfilesRepository.findByUserId(offer.userId);
    const to = await this.resolveRecipientEmail(offer.userId, profile);

    if (!to) {
      this.logger.warn(`No billing email found for user ${offer.userId}, skipping offer acceptance email`);

      return;
    }

    await this.emailDispatcher.publish({
      eventType: 'offer.accepted',
      scopeKey: getTenantIdOrDefault(),
      to,
      templateKey: 'offer-accepted-confirmation',
      templateContext: {
        recipientName: this.greeting(profile),
        offerNumber: offer.offerNumber,
        amountLabel: this.formatAmount(Number(offer.totalGross), offer.currency),
      },
    });
  }

  async publishVoidDocument(invoice: InvoiceEntity, pdfStorageKey: string, creditNoteNumber: string): Promise<void> {
    if (!invoice.invoiceNumber) {
      return;
    }

    const profile = await this.customerProfilesRepository.findByUserId(invoice.userId);
    const to = await this.resolveRecipientEmail(invoice.userId, profile);

    if (!to) {
      this.logger.warn(`No billing email found for user ${invoice.userId}, skipping void email`);

      return;
    }

    await this.emailDispatcher.publish({
      eventType: 'invoice.voided',
      scopeKey: getTenantIdOrDefault(),
      to,
      templateKey: 'invoice-voided',
      templateContext: {
        recipientName: this.greeting(profile),
        invoiceNumber: invoice.invoiceNumber,
        creditNoteNumber,
      },
      attachments: [{ storageKey: pdfStorageKey, filename: `${creditNoteNumber}.pdf` }],
    });
  }

  async publishPartialCreditDocument(
    invoice: InvoiceEntity,
    pdfStorageKey: string,
    creditNoteNumber: string,
    creditGross: number,
  ): Promise<void> {
    if (!invoice.invoiceNumber) {
      return;
    }

    const profile = await this.customerProfilesRepository.findByUserId(invoice.userId);
    const to = await this.resolveRecipientEmail(invoice.userId, profile);

    if (!to) {
      this.logger.warn(`No billing email found for user ${invoice.userId}, skipping partial credit email`);

      return;
    }

    await this.emailDispatcher.publish({
      eventType: 'invoice.partial_credit_issued',
      scopeKey: getTenantIdOrDefault(),
      to,
      templateKey: 'invoice-partial-credit',
      templateContext: {
        recipientName: this.greeting(profile),
        invoiceNumber: invoice.invoiceNumber,
        creditNoteNumber,
        creditAmountLabel: this.formatAmount(creditGross, invoice.currency),
      },
      attachments: [{ storageKey: pdfStorageKey, filename: `${creditNoteNumber}.pdf` }],
    });
  }

  async publishRenewalReminder(
    subscription: SubscriptionEntity,
    planName: string,
    recipientEmail: string,
    recipientName: string,
    renewalDate: string,
    options?: { billInAdvance?: boolean; periodEndDate?: string },
  ): Promise<void> {
    await this.emailDispatcher.publish({
      eventType: 'subscription.renewal_reminder',
      scopeKey: getTenantIdOrDefault(),
      to: recipientEmail,
      templateKey: 'subscription-renewal-reminder',
      templateContext: {
        recipientName,
        planName,
        renewalDate,
        subscriptionId: subscription.id,
        billInAdvance: options?.billInAdvance === true,
        ...(options?.periodEndDate ? { periodEndDate: options.periodEndDate } : {}),
      },
    });
  }

  async publishWithdrawalConfirmation(to: string, code: string, expiresAt: Date): Promise<void> {
    const hoursRemaining = Math.max(1, Math.round((expiresAt.getTime() - Date.now()) / (60 * 60 * 1000)));
    const expiryText = hoursRemaining === 1 ? '1 hour' : `${hoursRemaining} hours`;

    await this.emailDispatcher.publish({
      eventType: 'withdrawal.confirmation_requested',
      scopeKey: getTenantIdOrDefault(),
      to,
      templateKey: 'withdrawal-confirmation',
      templateContext: {
        code,
        expiryText,
      },
    });
  }

  async publishPaymentSucceeded(invoice: InvoiceEntity, context: Record<string, unknown> = {}): Promise<void> {
    await this.publishPaymentEmail('payment.succeeded', 'payment-succeeded', invoice, context);
  }

  async publishPaymentFailed(invoice: InvoiceEntity, context: Record<string, unknown> = {}): Promise<void> {
    await this.publishPaymentEmail('payment.failed', 'payment-failed', invoice, context);
  }

  async publishSubscriptionCreated(
    subscription: SubscriptionEntity,
    planName: string,
    options?: {
      billInAdvance?: boolean;
      addons?: Array<{ name: string; periodPrice?: number }>;
    },
  ): Promise<void> {
    const profile = await this.customerProfilesRepository.findByUserId(subscription.userId);
    const to = await this.resolveRecipientEmail(subscription.userId, profile);

    if (!to) {
      this.logger.warn(`No billing email for user ${subscription.userId}, skipping order confirmation email`);

      return;
    }

    const periodEndDate = subscription.currentPeriodEnd
      ? subscription.currentPeriodEnd.toLocaleDateString()
      : undefined;

    await this.emailDispatcher.publish({
      eventType: 'subscription.created',
      scopeKey: getTenantIdOrDefault(),
      to,
      templateKey: 'subscription-created',
      templateContext: {
        recipientName: this.greeting(profile),
        planName,
        billInAdvance: options?.billInAdvance === true,
        ...(subscription.number ? { subscriptionNumber: subscription.number } : {}),
        ...(periodEndDate ? { periodEndDate } : {}),
        ...(options?.addons && options.addons.length > 0 ? { addons: options.addons } : {}),
      },
    });
  }

  async publishConfigChangeRequested(subscription: SubscriptionEntity, planName: string): Promise<void> {
    await this.publishConfigChangeEmail(
      'subscription.config_change_requested',
      'subscription-config-change-requested',
      subscription,
      planName,
    );
  }

  async publishConfigChangeApplied(subscription: SubscriptionEntity, planName: string): Promise<void> {
    await this.publishConfigChangeEmail(
      'subscription.config_changed',
      'subscription-config-change-applied',
      subscription,
      planName,
    );
  }

  async publishConfigChangeFailed(subscription: SubscriptionEntity, planName: string): Promise<void> {
    await this.publishConfigChangeEmail(
      'subscription.config_change_failed',
      'subscription-config-change-failed',
      subscription,
      planName,
    );
  }

  /** Config-change emails stay generic: requested payloads may hold addon credentials. */
  private async publishConfigChangeEmail(
    eventType:
      | 'subscription.config_change_requested'
      | 'subscription.config_changed'
      | 'subscription.config_change_failed',
    templateKey:
      | 'subscription-config-change-requested'
      | 'subscription-config-change-applied'
      | 'subscription-config-change-failed',
    subscription: SubscriptionEntity,
    planName: string,
  ): Promise<void> {
    const profile = await this.customerProfilesRepository.findByUserId(subscription.userId);
    const to = await this.resolveRecipientEmail(subscription.userId, profile);

    if (!to) {
      this.logger.warn(`No billing email for user ${subscription.userId}, skipping ${eventType} email`);

      return;
    }

    await this.emailDispatcher.publish({
      eventType,
      scopeKey: getTenantIdOrDefault(),
      to,
      templateKey,
      templateContext: {
        recipientName: this.greeting(profile),
        planName,
        ...(subscription.number ? { subscriptionNumber: subscription.number } : {}),
      },
    });
  }

  async publishAddonActivated(subscription: SubscriptionEntity, planName: string, addonName: string): Promise<void> {
    await this.publishAddonEmail('addon.activated', 'addon-activated', subscription, planName, addonName);
  }

  async publishAddonDeactivated(subscription: SubscriptionEntity, planName: string, addonName: string): Promise<void> {
    await this.publishAddonEmail('addon.deactivated', 'addon-deactivated', subscription, planName, addonName);
  }

  async publishAddonProvisionFailed(
    subscription: SubscriptionEntity,
    planName: string,
    addonName: string,
  ): Promise<void> {
    await this.publishAddonEmail('addon.provision_failed', 'addon-provision-failed', subscription, planName, addonName);
  }

  async publishAddonTeardownFailed(
    subscription: SubscriptionEntity,
    planName: string,
    addonName: string,
  ): Promise<void> {
    await this.publishAddonEmail('addon.teardown_failed', 'addon-teardown-failed', subscription, planName, addonName);
  }

  private async publishAddonEmail(
    eventType: 'addon.activated' | 'addon.deactivated' | 'addon.provision_failed' | 'addon.teardown_failed',
    templateKey: 'addon-activated' | 'addon-deactivated' | 'addon-provision-failed' | 'addon-teardown-failed',
    subscription: SubscriptionEntity,
    planName: string,
    addonName: string,
  ): Promise<void> {
    const profile = await this.customerProfilesRepository.findByUserId(subscription.userId);
    const to = await this.resolveRecipientEmail(subscription.userId, profile);

    if (!to) {
      this.logger.warn(`No billing email for user ${subscription.userId}, skipping ${eventType} email`);

      return;
    }

    await this.emailDispatcher.publish({
      eventType,
      scopeKey: getTenantIdOrDefault(),
      to,
      templateKey,
      templateContext: {
        recipientName: this.greeting(profile),
        planName,
        addonName,
        ...(subscription.number ? { subscriptionNumber: subscription.number } : {}),
      },
    });
  }

  async publishSubscriptionWithdrawn(subscription: SubscriptionEntity, planName: string): Promise<void> {
    const profile = await this.customerProfilesRepository.findByUserId(subscription.userId);
    const to = await this.resolveRecipientEmail(subscription.userId, profile);

    if (!to) {
      this.logger.warn(`No billing email for user ${subscription.userId}, skipping withdrawal email`);

      return;
    }

    const withdrawnAt = subscription.withdrawnAt ? subscription.withdrawnAt.toLocaleDateString() : undefined;

    await this.emailDispatcher.publish({
      eventType: 'subscription.withdrawn',
      scopeKey: getTenantIdOrDefault(),
      to,
      templateKey: 'subscription-withdrawn',
      templateContext: {
        recipientName: this.greeting(profile),
        planName,
        ...(subscription.number ? { subscriptionNumber: subscription.number } : {}),
        ...(withdrawnAt ? { withdrawnAt } : {}),
      },
    });
  }

  async publishSubscriptionCancelScheduled(subscription: SubscriptionEntity, planName: string): Promise<void> {
    const profile = await this.customerProfilesRepository.findByUserId(subscription.userId);
    const to = await this.resolveRecipientEmail(subscription.userId, profile);

    if (!to) {
      this.logger.warn(`No billing email for user ${subscription.userId}, skipping cancel-scheduled email`);

      return;
    }

    const effectiveDate = subscription.cancelEffectiveAt
      ? subscription.cancelEffectiveAt.toLocaleDateString()
      : undefined;

    await this.emailDispatcher.publish({
      eventType: 'subscription.cancel_scheduled',
      scopeKey: getTenantIdOrDefault(),
      to,
      templateKey: 'subscription-cancel-scheduled',
      templateContext: {
        recipientName: this.greeting(profile),
        planName,
        ...(effectiveDate ? { effectiveDate } : {}),
      },
    });
  }

  async publishSubscriptionCanceled(subscription: SubscriptionEntity, planName: string): Promise<void> {
    const profile = await this.customerProfilesRepository.findByUserId(subscription.userId);
    const to = await this.resolveRecipientEmail(subscription.userId, profile);

    if (!to) {
      this.logger.warn(`No billing email for user ${subscription.userId}, skipping cancel email`);

      return;
    }

    const effectiveDate = subscription.cancelEffectiveAt
      ? subscription.cancelEffectiveAt.toLocaleDateString()
      : undefined;

    await this.emailDispatcher.publish({
      eventType: 'subscription.canceled',
      scopeKey: getTenantIdOrDefault(),
      to,
      templateKey: 'subscription-canceled',
      templateContext: {
        recipientName: this.greeting(profile),
        planName,
        ...(effectiveDate ? { effectiveDate } : {}),
      },
    });
  }

  async publishSubscriptionResumed(subscription: SubscriptionEntity, planName: string): Promise<void> {
    const profile = await this.customerProfilesRepository.findByUserId(subscription.userId);
    const to = await this.resolveRecipientEmail(subscription.userId, profile);

    if (!to) {
      this.logger.warn(`No billing email for user ${subscription.userId}, skipping resume email`);

      return;
    }

    await this.emailDispatcher.publish({
      eventType: 'subscription.resumed',
      scopeKey: getTenantIdOrDefault(),
      to,
      templateKey: 'subscription-resumed',
      templateContext: {
        recipientName: this.greeting(profile),
        planName,
      },
    });
  }

  /**
   * Notifies the customer that the SSH access key was revealed. Never includes the private key.
   */
  async publishSshAccessGranted(
    subscription: SubscriptionEntity,
    planName: string,
    context: { itemId: string; hostname?: string; grantedAt: Date },
  ): Promise<void> {
    const profile = await this.customerProfilesRepository.findByUserId(subscription.userId);
    const to = await this.resolveRecipientEmail(subscription.userId, profile);

    if (!to) {
      this.logger.warn(`No billing email for user ${subscription.userId}, skipping SSH access granted email`);

      return;
    }

    await this.emailDispatcher.publish({
      eventType: 'subscription.ssh_access_granted',
      scopeKey: getTenantIdOrDefault(),
      to,
      templateKey: 'ssh-access-granted',
      templateContext: {
        recipientName: this.greeting(profile),
        planName,
        subscriptionNumber: subscription.number ?? '',
        hostname: context.hostname ?? '',
        grantedAt: context.grantedAt.toLocaleString(),
      },
    });
  }

  async publishPriceChangedConsolidated(params: {
    tenantId: string;
    userId: string;
    runDate: string;
    withdrawalPeriodDays: number;
    changes: Array<{
      subscriptionNumber?: string;
      productName: string;
      oldNet: number;
      oldTax: number;
      oldTotal: number;
      newNet: number;
      newTax: number;
      newTotal: number;
    }>;
  }): Promise<void> {
    if (params.changes.length === 0) {
      return;
    }

    const profile = await this.customerProfilesRepository.findByUserId(params.userId);
    const to = await this.resolveRecipientEmail(params.userId, profile);

    if (!to) {
      this.logger.warn(`No billing email for user ${params.userId}, skipping price-change email`);

      return;
    }

    const currency = 'EUR';

    await this.emailDispatcher.publish({
      eventType: 'subscription.price_changed',
      scopeKey: getTenantIdOrDefault(),
      to,
      templateKey: 'price-change',
      correlationId: `price-recalc:${params.tenantId}:${params.userId}:${params.runDate}`,
      templateContext: {
        recipientName: this.greeting(profile),
        withdrawalPeriodDays: params.withdrawalPeriodDays,
        changes: params.changes.map((change) => ({
          ...(change.subscriptionNumber ? { subscriptionNumber: change.subscriptionNumber } : {}),
          productName: change.productName,
          oldNet: this.formatAmount(change.oldNet, currency),
          oldTax: this.formatAmount(change.oldTax, currency),
          oldTotal: this.formatAmount(change.oldTotal, currency),
          newNet: this.formatAmount(change.newNet, currency),
          newTax: this.formatAmount(change.newTax, currency),
          newTotal: this.formatAmount(change.newTotal, currency),
        })),
      },
    });
  }

  private async publishPaymentEmail(
    eventType: 'payment.succeeded' | 'payment.failed',
    templateKey: 'payment-succeeded' | 'payment-failed',
    invoice: InvoiceEntity,
    context: Record<string, unknown>,
  ): Promise<void> {
    if (!invoice.invoiceNumber) {
      return;
    }

    const profile = await this.customerProfilesRepository.findByUserId(invoice.userId);
    const to = await this.resolveRecipientEmail(invoice.userId, profile);

    if (!to) {
      this.logger.warn(`No billing email for user ${invoice.userId}, skipping ${eventType} email`);

      return;
    }

    await this.emailDispatcher.publish({
      eventType,
      scopeKey: getTenantIdOrDefault(),
      to,
      templateKey,
      templateContext: {
        recipientName: this.greeting(profile),
        invoiceNumber: invoice.invoiceNumber,
        amountLabel: this.formatAmount(Number(invoice.totalGross), invoice.currency),
        ...context,
      },
    });
  }

  private async resolveRecipientEmail(
    userId: string,
    profile: CustomerProfileEntity | null,
  ): Promise<string | undefined> {
    const profileEmail = profile?.email?.trim();

    if (profileEmail) {
      return profileEmail;
    }

    const user = await this.usersRepository.findByIdForTenant(userId);

    return user?.email?.trim();
  }

  private greeting(profile: CustomerProfileEntity | null): string {
    return profile?.firstName?.trim() || 'Customer';
  }

  private formatAmount(amount: number, currency: string): string {
    return `${amount.toFixed(2)} ${currency}`;
  }

  private formatDueDate(dueDate?: Date | string | null): string | undefined {
    if (dueDate == null || dueDate === '') {
      return undefined;
    }

    const parsed = dueDate instanceof Date ? dueDate : new Date(dueDate);

    if (Number.isNaN(parsed.getTime())) {
      return undefined;
    }

    return parsed.toLocaleDateString();
  }
}
