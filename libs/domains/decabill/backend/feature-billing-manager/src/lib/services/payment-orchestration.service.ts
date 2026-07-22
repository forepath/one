import { createHash } from 'crypto';

import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { getTenantIdOrDefault, runWithTenantId } from '@forepath/shared/backend';

import { AutoPaymentStatus, isAutoPaymentBlocking } from '../constants/auto-payment-status.constants';
import { InvoiceStatus } from '../constants/invoice-status.constants';
import { getMinCheckoutPaymentAmount } from '../constants/payment-amount.constants';
import type { InvoiceEntity } from '../entities/invoice.entity';
import { PaymentAttemptStatus } from '../entities/payment-attempt.entity';
import { PaymentProcessorFactory } from '../payment-processors/payment-processor.factory';
import { CustomerProfilesRepository } from '../repositories/customer-profiles.repository';
import { InvoicesRepository } from '../repositories/invoices.repository';
import { PaymentAttemptsRepository } from '../repositories/payment-attempts.repository';
import { PaymentWebhookEventsRepository } from '../repositories/payment-webhook-events.repository';
import { buildStripeCheckoutReturnUrl } from '../utils/tenant-frontend-url.utils';

import { AutoBillingService } from './auto-billing.service';
import { BillingAuditLogService } from './billing-audit-log.service';
import { BillingNotificationPublisher } from '../notifications/billing-notification.publisher';
import { BillingEmailPublisher } from '../email/billing-email.publisher';
import { CustomerTrustScoreService } from '../trust-score/customer-trust-score.service';

@Injectable()
export class PaymentOrchestrationService {
  private readonly logger = new Logger(PaymentOrchestrationService.name);

  constructor(
    private readonly invoicesRepository: InvoicesRepository,
    private readonly paymentAttemptsRepository: PaymentAttemptsRepository,
    private readonly paymentWebhookEventsRepository: PaymentWebhookEventsRepository,
    private readonly customerProfilesRepository: CustomerProfilesRepository,
    private readonly paymentProcessorFactory: PaymentProcessorFactory,
    private readonly auditLog: BillingAuditLogService,
    private readonly billingNotificationPublisher: BillingNotificationPublisher,
    private readonly billingEmailPublisher: BillingEmailPublisher,
    private readonly autoBillingService: AutoBillingService,
    private readonly customerTrustScoreService: CustomerTrustScoreService,
  ) {}

  async initiatePayment(invoiceId: string, subscriptionId: string, userId: string): Promise<{ checkoutUrl: string }> {
    const invoice = await this.invoicesRepository.findByIdAndSubscriptionId(invoiceId, subscriptionId);

    if (!invoice || invoice.userId !== userId) {
      throw new BadRequestException('Invoice not found');
    }

    return await this.initiatePaymentForInvoice(invoice, userId, subscriptionId);
  }

  async initiatePaymentForUser(invoiceId: string, userId: string): Promise<{ checkoutUrl: string }> {
    const invoice = await this.invoicesRepository.findByIdForUser(invoiceId, userId);

    if (!invoice) {
      throw new BadRequestException('Invoice not found');
    }

    return await this.initiatePaymentForInvoice(invoice, userId, invoice.subscriptionId ?? '');
  }

  private async initiatePaymentForInvoice(
    invoice: InvoiceEntity,
    userId: string,
    subscriptionId: string,
  ): Promise<{ checkoutUrl: string }> {
    if (invoice.status === InvoiceStatus.VOID || invoice.status === InvoiceStatus.PAID) {
      throw new BadRequestException('Invoice is not payable');
    }

    if (isAutoPaymentBlocking(invoice.autoPaymentStatus)) {
      throw new BadRequestException('Manual payment is blocked while auto-billing is in progress');
    }

    const balance = Number(invoice.balanceDue);

    if (balance <= 0) {
      throw new BadRequestException('Nothing to pay');
    }

    const minCheckoutPaymentAmount = getMinCheckoutPaymentAmount();

    if (balance < minCheckoutPaymentAmount) {
      throw new BadRequestException(
        `Payment is only available for amounts of ${minCheckoutPaymentAmount.toFixed(2)} or more`,
      );
    }

    const processorType = invoice.paymentProcessor ?? process.env.BILLING_DEFAULT_PAYMENT_PROCESSOR ?? 'stripe';
    const processor = this.paymentProcessorFactory.getProcessor(processorType);
    const idempotencyKey = `pay-${invoice.id}-${Date.now()}`;
    const profile = await this.customerProfilesRepository.findByUserId(userId);
    const tenantId = getTenantIdOrDefault();
    const returnParams = { invoiceRefId: invoice.id, subscriptionId };
    const successUrl = buildStripeCheckoutReturnUrl(tenantId, 'success', returnParams);
    const cancelUrl = buildStripeCheckoutReturnUrl(tenantId, 'cancel', returnParams);
    const session = await processor.createCheckoutSession({
      invoiceId: invoice.id,
      amount: balance,
      currency: invoice.currency,
      customerEmail: profile?.email,
      stripeCustomerId: profile?.stripeCustomerId,
      successUrl,
      cancelUrl,
      idempotencyKey,
      metadata: {
        invoiceId: invoice.id,
        subscriptionId,
        userId,
        invoiceNumber: invoice.invoiceNumber ?? '',
        tenantId,
        mode: 'checkout',
      },
    });

    await this.paymentAttemptsRepository.create({
      invoiceId: invoice.id,
      processor: processorType,
      externalId: session.externalId,
      status: PaymentAttemptStatus.PENDING,
      amount: balance,
      currency: invoice.currency,
      idempotencyKey,
      metadata: { checkoutUrl: session.checkoutUrl, kind: 'checkout' },
    });

    await this.invoicesRepository.update(invoice.id, { externalPaymentId: session.externalId });

    await this.auditLog.log({
      process: 'payment.init',
      level: 'info',
      message: 'Payment checkout session created',
      invoiceId: invoice.id,
      userId,
      context: { processor: processorType, externalId: session.externalId },
    });

    this.billingNotificationPublisher.publishPayment('payment.initiated', invoice, {
      processor: processorType,
      externalId: session.externalId,
      mode: 'checkout',
    });

    return { checkoutUrl: session.checkoutUrl };
  }

  async handleWebhook(processorType: string, rawBody: Buffer | string, signature: string | undefined): Promise<void> {
    const processor = this.paymentProcessorFactory.getProcessor(processorType);

    if (!processor.verifyWebhookSignature(rawBody, signature)) {
      throw new BadRequestException('Invalid webhook signature');
    }

    const event = processor.parseWebhookEvent(rawBody);
    const payloadHash = createHash('sha256')
      .update(typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8'))
      .digest('hex');

    if (await this.paymentWebhookEventsRepository.exists(processorType, event.eventId)) {
      this.logger.log(`Skipping duplicate webhook event ${event.eventId}`);

      return;
    }

    const paymentUpdate = await Promise.resolve(processor.mapWebhookToPaymentUpdate(event));
    const setupUpdate = !paymentUpdate ? await Promise.resolve(processor.mapWebhookToSetupUpdate(event)) : null;

    await this.paymentWebhookEventsRepository.create({
      processor: processorType,
      eventId: event.eventId,
      payloadHash,
      result: paymentUpdate || setupUpdate ? 'processed' : 'ignored',
    });

    if (setupUpdate) {
      if (!setupUpdate.tenantId || !setupUpdate.userId || !setupUpdate.paymentMethodExternalId) {
        this.logger.warn(`Setup webhook event ${event.eventId} missing tenantId/userId/payment method; ignoring`);

        return;
      }

      await runWithTenantId(setupUpdate.tenantId, async () => {
        await this.autoBillingService.attachPaymentMethod({
          userId: setupUpdate.userId!,
          paymentMethodExternalId: setupUpdate.paymentMethodExternalId!,
          stripeCustomerId: setupUpdate.stripeCustomerId,
        });
      });

      return;
    }

    if (!paymentUpdate) {
      return;
    }

    if (!paymentUpdate.tenantId) {
      this.logger.warn(`Webhook event ${event.eventId} missing tenantId metadata; ignoring payment update`);

      return;
    }

    await runWithTenantId(paymentUpdate.tenantId, async () => {
      await this.applyPaymentUpdate(paymentUpdate, processorType);
    });
  }

  private async applyPaymentUpdate(
    update: {
      invoiceId: string;
      externalId: string;
      status: string;
      amountPaid?: number;
      userId?: string;
      mode?: 'auto' | 'checkout';
      paymentMethodExternalId?: string;
      stripeCustomerId?: string;
    },
    processorType: string,
  ): Promise<void> {
    const invoice = await this.invoicesRepository.findById(update.invoiceId);

    if (!invoice) {
      this.logger.warn(`Webhook referenced unknown invoice ${update.invoiceId}`);

      return;
    }

    const attempt = await this.paymentAttemptsRepository.findByExternalId(processorType, update.externalId);
    const mode = update.mode ?? (attempt?.metadata?.['kind'] === 'auto' ? 'auto' : 'checkout');

    if (update.status === 'succeeded') {
      if (invoice.status === InvoiceStatus.PAID) {
        if (mode === 'auto') {
          await this.autoBillingService.onAutoPaymentSucceeded(invoice, {
            paymentMethodExternalId: update.paymentMethodExternalId,
            stripeCustomerId: update.stripeCustomerId,
          });
        } else if (update.paymentMethodExternalId && (update.userId || invoice.userId)) {
          await this.autoBillingService.onCheckoutPaymentMethodCaptured({
            userId: update.userId ?? invoice.userId,
            paymentMethodExternalId: update.paymentMethodExternalId,
            stripeCustomerId: update.stripeCustomerId,
          });
        }

        if (attempt && attempt.status !== PaymentAttemptStatus.SUCCEEDED) {
          await this.paymentAttemptsRepository.update(attempt.id, { status: PaymentAttemptStatus.SUCCEEDED });
        }

        this.logger.log(`Skipping duplicate payment success for invoice ${invoice.id} (already paid)`);

        return;
      }

      const paid = await this.invoicesRepository.update(invoice.id, {
        status: InvoiceStatus.PAID,
        balanceDue: 0,
      });

      if (attempt) {
        await this.paymentAttemptsRepository.update(attempt.id, { status: PaymentAttemptStatus.SUCCEEDED });
      }

      if (mode === 'auto') {
        await this.autoBillingService.onAutoPaymentSucceeded(paid, {
          paymentMethodExternalId: update.paymentMethodExternalId,
          stripeCustomerId: update.stripeCustomerId,
        });
      } else if (update.paymentMethodExternalId && (update.userId || invoice.userId)) {
        await this.autoBillingService.onCheckoutPaymentMethodCaptured({
          userId: update.userId ?? invoice.userId,
          paymentMethodExternalId: update.paymentMethodExternalId,
          stripeCustomerId: update.stripeCustomerId,
        });
      }

      await this.auditLog.log({
        process: 'payment.webhook',
        level: 'info',
        message: 'Invoice marked paid',
        invoiceId: invoice.id,
        userId: invoice.userId,
        context: { externalId: update.externalId, mode },
      });

      this.billingNotificationPublisher.publishPayment('payment.succeeded', paid, {
        processor: processorType,
        externalId: update.externalId,
        mode,
      });
      await this.billingEmailPublisher.publishPaymentSucceeded(paid, {
        processor: processorType,
        externalId: update.externalId,
      });
      this.customerTrustScoreService.triggerRecomputeForUser(invoice.userId);

      return;
    }

    if (update.status === 'canceled' && attempt) {
      await this.paymentAttemptsRepository.update(attempt.id, { status: PaymentAttemptStatus.CANCELED });

      return;
    }

    if (update.status === 'failed' && attempt) {
      await this.paymentAttemptsRepository.update(attempt.id, { status: PaymentAttemptStatus.FAILED });

      if (mode === 'auto') {
        if (invoice.autoPaymentStatus !== AutoPaymentStatus.IN_PROGRESS) {
          this.logger.log(`Skipping duplicate auto-payment failure for invoice ${invoice.id}`);

          return;
        }

        await this.autoBillingService.onAutoPaymentFailed(
          invoice,
          invoice.autoPaymentAttemptCount || 1,
          processorType,
          update.externalId,
        );
      } else {
        this.billingNotificationPublisher.publishPayment('payment.failed', invoice, {
          processor: processorType,
          externalId: update.externalId,
          mode: 'checkout',
        });
        await this.billingEmailPublisher.publishPaymentFailed(invoice, {
          processor: processorType,
          externalId: update.externalId,
        });
        this.customerTrustScoreService.triggerRecomputeForUser(invoice.userId);
      }
    }
  }
}
