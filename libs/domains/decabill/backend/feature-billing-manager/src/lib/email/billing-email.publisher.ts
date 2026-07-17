import {
  EmailNotificationDispatcherService,
  getTenantIdOrDefault,
  type EmailAttachmentRef,
} from '@forepath/shared/backend';
import { Injectable, Logger } from '@nestjs/common';
import { UsersRepository } from '@forepath/identity/backend';

import type { CustomerProfileEntity } from '../entities/customer-profile.entity';
import type { InvoiceEntity } from '../entities/invoice.entity';
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
