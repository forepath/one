import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { getTenantIdOrDefault } from '@forepath/shared/backend';

import {
  AUTO_PAYMENT_MAX_ATTEMPTS,
  AutoPaymentStatus,
  getAutoPaymentPendingSafetyDelayMs,
  getAutoPaymentRetryDelayMs,
} from '../constants/auto-payment-status.constants';
import { InvoiceStatus, OPEN_OVERDUE_INVOICE_STATUSES } from '../constants/invoice-status.constants';
import { getMinCheckoutPaymentAmount } from '../constants/payment-amount.constants';
import type { CustomerProfileEntity } from '../entities/customer-profile.entity';
import type { InvoiceEntity } from '../entities/invoice.entity';
import { PaymentAttemptStatus } from '../entities/payment-attempt.entity';
import { BillingNotificationPublisher } from '../notifications/billing-notification.publisher';
import { PaymentProcessorFactory } from '../payment-processors/payment-processor.factory';
import { CustomerProfilesRepository } from '../repositories/customer-profiles.repository';
import { InvoicesRepository } from '../repositories/invoices.repository';
import { PaymentAttemptsRepository } from '../repositories/payment-attempts.repository';
import { resolveTenantFrontendBaseUrl } from '../utils/tenant-frontend-url.utils';

import { BillingAuditLogService } from './billing-audit-log.service';
import { CustomerProfilesService } from './customer-profiles.service';
import { BillingEmailPublisher } from '../email/billing-email.publisher';

export interface AutoBillingSetupResult {
  setupUrl: string;
}

@Injectable()
export class AutoBillingService {
  private readonly logger = new Logger(AutoBillingService.name);
  private readonly batchSize = parseInt(process.env.INVOICE_AUTO_PAYMENT_SCHEDULER_BATCH_SIZE ?? '100', 10);

  constructor(
    private readonly customerProfilesRepository: CustomerProfilesRepository,
    private readonly customerProfilesService: CustomerProfilesService,
    private readonly invoicesRepository: InvoicesRepository,
    private readonly paymentAttemptsRepository: PaymentAttemptsRepository,
    private readonly paymentProcessorFactory: PaymentProcessorFactory,
    private readonly auditLog: BillingAuditLogService,
    private readonly billingNotificationPublisher: BillingNotificationPublisher,
    private readonly billingEmailPublisher: BillingEmailPublisher,
  ) {}

  get batchSizeLimit(): number {
    return this.batchSize;
  }

  resolveDefaultProcessorType(): string {
    return process.env.BILLING_DEFAULT_PAYMENT_PROCESSOR ?? 'stripe';
  }

  getDefaultProcessor() {
    return this.paymentProcessorFactory.getProcessor(this.resolveDefaultProcessorType());
  }

  async createSetupSessionForUser(userId: string): Promise<AutoBillingSetupResult> {
    const processor = this.getDefaultProcessor();

    if (!processor.supportsAutoPayment()) {
      throw new BadRequestException('Payment processor does not support auto-billing');
    }

    const profile = await this.requireCompleteProfile(userId);
    const tenantId = getTenantIdOrDefault();
    const baseUrl = resolveTenantFrontendBaseUrl(tenantId);
    const successUrl = `${baseUrl}/subscriptions?profile=true&autoBilling=setup_success`;
    const cancelUrl = `${baseUrl}/subscriptions?profile=true&autoBilling=setup_cancel`;
    const idempotencyKey = `auto-setup-${userId}-${Date.now()}`;
    const session = await processor.createSetupSession({
      customerEmail: profile.email,
      stripeCustomerId: profile.stripeCustomerId,
      currency: process.env.BILLING_DEFAULT_CURRENCY ?? 'EUR',
      successUrl,
      cancelUrl,
      idempotencyKey,
      metadata: {
        userId,
        tenantId,
        purpose: 'auto_billing_setup',
      },
    });

    if (session.stripeCustomerId && session.stripeCustomerId !== profile.stripeCustomerId) {
      await this.customerProfilesRepository.update(profile.id, {
        stripeCustomerId: session.stripeCustomerId,
      });
    }

    await this.auditLog.log({
      process: 'auto_billing.setup',
      level: 'info',
      message: 'Auto-billing payment method setup session created',
      userId,
      context: { externalId: session.externalId, processor: processor.getType() },
    });

    return { setupUrl: session.setupUrl };
  }

  async enableForUser(userId: string): Promise<CustomerProfileEntity> {
    const processor = this.getDefaultProcessor();

    if (!processor.supportsAutoPayment()) {
      throw new BadRequestException('Payment processor does not support auto-billing');
    }

    const profile = await this.requireCompleteProfile(userId);

    if (!profile.defaultPaymentMethodExternalId || !profile.stripeCustomerId) {
      throw new BadRequestException('A payment method must be on file before enabling auto-billing');
    }

    const updated = await this.customerProfilesRepository.update(profile.id, {
      autoBillingEnabled: true,
    });

    await this.auditLog.log({
      process: 'auto_billing.enable',
      level: 'info',
      message: 'Auto-billing enabled',
      userId,
    });

    this.billingNotificationPublisher.publish('auto_billing.enabled', { userId, profileId: updated.id }, userId);

    await this.rescheduleOpenInvoicesForUser(userId);

    return updated;
  }

  async disableForUser(userId: string): Promise<CustomerProfileEntity> {
    const profile = await this.requireProfile(userId);
    const updated = await this.customerProfilesRepository.update(profile.id, {
      autoBillingEnabled: false,
    });

    await this.cancelAutoPaymentsForUser(userId);

    await this.auditLog.log({
      process: 'auto_billing.disable',
      level: 'info',
      message: 'Auto-billing disabled; manual payment unlocked',
      userId,
    });

    this.billingNotificationPublisher.publish('auto_billing.disabled', { userId, profileId: updated.id }, userId);

    return updated;
  }

  async attachPaymentMethod(params: {
    userId: string;
    paymentMethodExternalId: string;
    stripeCustomerId?: string;
  }): Promise<void> {
    const profile = await this.requireProfile(params.userId);
    const patch: Partial<CustomerProfileEntity> = {
      defaultPaymentMethodExternalId: params.paymentMethodExternalId,
    };

    if (params.stripeCustomerId) {
      patch.stripeCustomerId = params.stripeCustomerId;
    }

    await this.customerProfilesRepository.update(profile.id, patch);

    this.billingNotificationPublisher.publish(
      'payment_method.attached',
      {
        userId: params.userId,
        paymentMethodExternalId: params.paymentMethodExternalId,
      },
      params.userId,
    );
  }

  async scheduleIfEligible(invoice: InvoiceEntity): Promise<void> {
    if (
      !OPEN_OVERDUE_INVOICE_STATUSES.includes(invoice.status) ||
      Number(invoice.balanceDue) < getMinCheckoutPaymentAmount()
    ) {
      return;
    }

    const profile = await this.customerProfilesRepository.findByUserId(invoice.userId);

    if (!profile?.autoBillingEnabled || !profile.defaultPaymentMethodExternalId || !profile.stripeCustomerId) {
      return;
    }

    if (!this.customerProfilesService.isProfileComplete(profile)) {
      this.logger.debug(`Skipping auto-payment schedule for invoice ${invoice.id}: customer profile incomplete`);

      return;
    }

    const processorType = invoice.paymentProcessor ?? this.resolveDefaultProcessorType();
    let processor;

    try {
      processor = this.paymentProcessorFactory.getProcessor(processorType);
    } catch {
      this.logger.warn(`Cannot schedule auto-payment: processor ${processorType} not registered`);

      return;
    }

    if (!processor.supportsAutoPayment()) {
      return;
    }

    await this.invoicesRepository.update(invoice.id, {
      autoPaymentStatus: AutoPaymentStatus.SCHEDULED,
      autoPaymentAttemptCount: 0,
      autoPaymentNextRetryAt: new Date(),
    });
  }

  async rescheduleOpenInvoicesForUser(userId: string): Promise<void> {
    const invoices = await this.invoicesRepository.findOpenOverdueByUserId(userId);

    for (const invoice of invoices) {
      await this.scheduleIfEligible(invoice);
    }
  }

  async cancelAutoPaymentsForUser(userId: string): Promise<void> {
    const invoices = await this.invoicesRepository.findOpenOverdueByUserId(userId);

    for (const invoice of invoices) {
      // Leave IN_PROGRESS alone so an in-flight Stripe charge is not unlocked for a second Checkout.
      if (
        invoice.autoPaymentStatus === AutoPaymentStatus.SCHEDULED ||
        invoice.autoPaymentStatus === AutoPaymentStatus.RETRYING
      ) {
        await this.invoicesRepository.update(invoice.id, {
          autoPaymentStatus: AutoPaymentStatus.CANCELED,
          autoPaymentNextRetryAt: null,
        });
      }
    }
  }

  async findInvoiceIdsDueForAutoPayment(offset: number): Promise<string[]> {
    return await this.invoicesRepository.findIdsDueForAutoPayment(this.batchSize, offset);
  }

  async attemptAutoPayment(invoiceId: string): Promise<void> {
    let invoice = await this.invoicesRepository.findById(invoiceId);

    if (!invoice) {
      return;
    }

    if (invoice.autoPaymentStatus === AutoPaymentStatus.IN_PROGRESS) {
      if (!invoice.autoPaymentNextRetryAt || invoice.autoPaymentNextRetryAt.getTime() > Date.now()) {
        return;
      }

      // Safety timeout for pending/SCA: release claim so a later attempt can proceed without unlocking early.
      const rewindedAttemptCount = Math.max(0, (invoice.autoPaymentAttemptCount ?? 1) - 1);
      const released = await this.invoicesRepository.transitionAutoPaymentFromInProgress(invoice.id, {
        autoPaymentStatus: AutoPaymentStatus.RETRYING,
        autoPaymentNextRetryAt: null,
        autoPaymentAttemptCount: rewindedAttemptCount,
      });

      if (!released) {
        return;
      }

      invoice = {
        ...invoice,
        autoPaymentStatus: AutoPaymentStatus.RETRYING,
        autoPaymentNextRetryAt: null,
        autoPaymentAttemptCount: rewindedAttemptCount,
      };
    }

    if (
      invoice.autoPaymentStatus !== AutoPaymentStatus.SCHEDULED &&
      invoice.autoPaymentStatus !== AutoPaymentStatus.RETRYING
    ) {
      return;
    }

    if (!OPEN_OVERDUE_INVOICE_STATUSES.includes(invoice.status) || Number(invoice.balanceDue) <= 0) {
      await this.invoicesRepository.update(invoiceId, {
        autoPaymentStatus: AutoPaymentStatus.CANCELED,
        autoPaymentNextRetryAt: null,
      });

      return;
    }

    if (Number(invoice.balanceDue) < getMinCheckoutPaymentAmount()) {
      this.logger.debug(`Canceling auto-payment for invoice ${invoiceId}: balance below minimum checkout amount`);
      await this.invoicesRepository.update(invoiceId, {
        autoPaymentStatus: AutoPaymentStatus.CANCELED,
        autoPaymentNextRetryAt: null,
      });

      return;
    }

    const profile = await this.customerProfilesRepository.findByUserId(invoice.userId);

    if (!profile?.autoBillingEnabled || !profile.defaultPaymentMethodExternalId || !profile.stripeCustomerId) {
      await this.invoicesRepository.update(invoiceId, {
        autoPaymentStatus: AutoPaymentStatus.CANCELED,
        autoPaymentNextRetryAt: null,
      });

      return;
    }

    if (!this.customerProfilesService.isProfileComplete(profile)) {
      const nextRetryAt = new Date(Date.now() + getAutoPaymentPendingSafetyDelayMs());

      this.logger.debug(
        `Deferring auto-payment for invoice ${invoiceId}: customer profile incomplete; next retry at ${nextRetryAt.toISOString()}`,
      );
      await this.invoicesRepository.update(invoiceId, {
        autoPaymentNextRetryAt: nextRetryAt,
      });

      return;
    }

    const processorType = invoice.paymentProcessor ?? this.resolveDefaultProcessorType();
    const processor = this.paymentProcessorFactory.getProcessor(processorType);

    if (!processor.supportsAutoPayment()) {
      await this.invoicesRepository.update(invoiceId, {
        autoPaymentStatus: AutoPaymentStatus.EXHAUSTED,
        autoPaymentNextRetryAt: null,
      });

      return;
    }

    const attemptNumber = (invoice.autoPaymentAttemptCount ?? 0) + 1;
    const claimed = await this.invoicesRepository.claimForAutoPayment(invoiceId, attemptNumber);

    if (!claimed) {
      this.logger.debug(`Skipping auto-payment for invoice ${invoiceId}: claim lost to another worker`);

      return;
    }

    const idempotencyKey = `auto-pay-${claimed.id}-${attemptNumber}`;
    const tenantId = getTenantIdOrDefault();

    this.billingNotificationPublisher.publish(
      'payment.auto.initiated',
      {
        invoiceId: claimed.id,
        userId: claimed.userId,
        attempt: attemptNumber,
        processor: processorType,
      },
      claimed.userId,
    );

    const result = await processor.chargeOffSession({
      invoiceId: claimed.id,
      amount: Number(claimed.balanceDue),
      currency: claimed.currency,
      stripeCustomerId: profile.stripeCustomerId,
      paymentMethodExternalId: profile.defaultPaymentMethodExternalId,
      idempotencyKey,
      metadata: {
        invoiceId: claimed.id,
        userId: claimed.userId,
        tenantId,
        mode: 'auto',
        invoiceNumber: claimed.invoiceNumber ?? '',
      },
    });

    await this.paymentAttemptsRepository.create({
      invoiceId: claimed.id,
      processor: processorType,
      externalId: result.externalId,
      status:
        result.status === 'succeeded'
          ? PaymentAttemptStatus.SUCCEEDED
          : result.status === 'pending'
            ? PaymentAttemptStatus.PENDING
            : PaymentAttemptStatus.FAILED,
      amount: Number(claimed.balanceDue),
      currency: claimed.currency,
      idempotencyKey,
      metadata: { kind: 'auto', attempt: attemptNumber },
    });

    await this.invoicesRepository.update(claimed.id, { externalPaymentId: result.externalId });

    if (result.status === 'succeeded') {
      await this.markInvoicePaidFromAutoCharge(claimed, processorType, result.externalId);

      return;
    }

    if (result.status === 'pending') {
      // Stay IN_PROGRESS so disable cannot unlock manual Checkout while the PI may still succeed.
      // Safety nextRetryAt lets the coordinator recover stuck pending attempts later.
      const nextRetryAt = new Date(Date.now() + getAutoPaymentPendingSafetyDelayMs());

      await this.invoicesRepository.update(claimed.id, {
        autoPaymentNextRetryAt: nextRetryAt,
      });

      this.logger.debug(`Auto-payment pending for invoice ${claimed.id}; safety retry at ${nextRetryAt.toISOString()}`);

      return;
    }

    await this.onAutoPaymentFailed(claimed, attemptNumber, processorType, result.externalId);
  }

  async onAutoPaymentSucceeded(invoice: InvoiceEntity, context: Record<string, unknown> = {}): Promise<void> {
    await this.invoicesRepository.update(invoice.id, {
      autoPaymentStatus: AutoPaymentStatus.SUCCEEDED,
      autoPaymentNextRetryAt: null,
    });

    if (typeof context['paymentMethodExternalId'] === 'string' && context['paymentMethodExternalId']) {
      await this.attachPaymentMethod({
        userId: invoice.userId,
        paymentMethodExternalId: context['paymentMethodExternalId'],
        stripeCustomerId: typeof context['stripeCustomerId'] === 'string' ? context['stripeCustomerId'] : undefined,
      });
    }
  }

  async onAutoPaymentFailed(
    invoice: InvoiceEntity,
    attemptNumber: number,
    processorType: string,
    externalId: string,
  ): Promise<void> {
    const willRetry = attemptNumber < AUTO_PAYMENT_MAX_ATTEMPTS;
    const nextRetryAt = willRetry ? new Date(Date.now() + getAutoPaymentRetryDelayMs(attemptNumber - 1)) : null;
    const nextStatus = willRetry ? AutoPaymentStatus.RETRYING : AutoPaymentStatus.EXHAUSTED;
    const transitioned = await this.invoicesRepository.transitionAutoPaymentFromInProgress(invoice.id, {
      autoPaymentStatus: nextStatus,
      autoPaymentNextRetryAt: nextRetryAt,
    });

    if (!transitioned) {
      this.logger.debug(`Skipping duplicate auto-payment failure handling for invoice ${invoice.id}`);

      return;
    }

    this.billingNotificationPublisher.publishPayment('payment.failed', invoice, {
      processor: processorType,
      externalId,
      mode: 'auto',
      attempt: attemptNumber,
      willRetry,
    });

    if (willRetry && nextRetryAt) {
      this.billingNotificationPublisher.publish(
        'payment.auto.retry_scheduled',
        {
          invoiceId: invoice.id,
          userId: invoice.userId,
          attempt: attemptNumber,
          nextRetryAt: nextRetryAt.toISOString(),
        },
        invoice.userId,
      );

      return;
    }

    this.billingNotificationPublisher.publish(
      'payment.auto.exhausted',
      {
        invoiceId: invoice.id,
        userId: invoice.userId,
        attempt: attemptNumber,
      },
      invoice.userId,
    );
  }

  async onCheckoutPaymentMethodCaptured(params: {
    userId: string;
    paymentMethodExternalId?: string;
    stripeCustomerId?: string;
  }): Promise<void> {
    if (!params.paymentMethodExternalId) {
      return;
    }

    await this.attachPaymentMethod({
      userId: params.userId,
      paymentMethodExternalId: params.paymentMethodExternalId,
      stripeCustomerId: params.stripeCustomerId,
    });
  }

  private async markInvoicePaidFromAutoCharge(
    invoice: InvoiceEntity,
    processorType: string,
    externalId: string,
  ): Promise<void> {
    const current = await this.invoicesRepository.findById(invoice.id);

    if (!current) {
      return;
    }

    if (current.status === InvoiceStatus.PAID) {
      await this.invoicesRepository.update(invoice.id, {
        autoPaymentStatus: AutoPaymentStatus.SUCCEEDED,
        autoPaymentNextRetryAt: null,
      });
      this.logger.debug(`Skipping duplicate auto-payment success handling for invoice ${invoice.id}`);

      return;
    }

    const paid = await this.invoicesRepository.update(invoice.id, {
      status: InvoiceStatus.PAID,
      balanceDue: 0,
      autoPaymentStatus: AutoPaymentStatus.SUCCEEDED,
      autoPaymentNextRetryAt: null,
    });

    await this.auditLog.log({
      process: 'payment.auto',
      level: 'info',
      message: 'Invoice marked paid via auto-billing',
      invoiceId: invoice.id,
      userId: invoice.userId,
      context: { externalId, processor: processorType },
    });

    this.billingNotificationPublisher.publishPayment('payment.succeeded', paid, {
      processor: processorType,
      externalId,
      mode: 'auto',
    });
    await this.billingEmailPublisher.publishPaymentSucceeded(paid, {
      processor: processorType,
      externalId,
      mode: 'auto',
    });
  }

  private async requireProfile(userId: string): Promise<CustomerProfileEntity> {
    const profile = await this.customerProfilesRepository.findByUserId(userId);

    if (!profile) {
      throw new BadRequestException('Customer profile not found');
    }

    return profile;
  }

  private async requireCompleteProfile(userId: string): Promise<CustomerProfileEntity> {
    const profile = await this.requireProfile(userId);

    if (!this.customerProfilesService.isProfileComplete(profile)) {
      throw new BadRequestException('Customer profile must be complete before using auto-billing');
    }

    return profile;
  }
}
