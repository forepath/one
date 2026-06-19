import { createHash } from 'crypto';

import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { getTenantIdOrDefault, runWithTenantId } from '@forepath/shared/backend';

import { InvoiceStatus } from '../constants/invoice-status.constants';
import type { InvoiceEntity } from '../entities/invoice.entity';
import { PaymentAttemptStatus } from '../entities/payment-attempt.entity';
import { PaymentProcessorFactory } from '../payment-processors/payment-processor.factory';
import { CustomerProfilesRepository } from '../repositories/customer-profiles.repository';
import { InvoicesRepository } from '../repositories/invoices.repository';
import { PaymentAttemptsRepository } from '../repositories/payment-attempts.repository';
import { PaymentWebhookEventsRepository } from '../repositories/payment-webhook-events.repository';
import { buildStripeCheckoutReturnUrl } from '../utils/tenant-frontend-url.utils';

import { BillingAuditLogService } from './billing-audit-log.service';

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

    const balance = Number(invoice.balanceDue);

    if (balance <= 0) {
      throw new BadRequestException('Nothing to pay');
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
      metadata: { checkoutUrl: session.checkoutUrl },
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

    const update = processor.mapWebhookToPaymentUpdate(event);

    await this.paymentWebhookEventsRepository.create({
      processor: processorType,
      eventId: event.eventId,
      payloadHash,
      result: update ? 'processed' : 'ignored',
    });

    if (!update) {
      return;
    }

    if (!update.tenantId) {
      this.logger.warn(`Webhook event ${event.eventId} missing tenantId metadata; ignoring payment update`);

      return;
    }

    await runWithTenantId(update.tenantId, async () => {
      await this.applyPaymentUpdate(update, processorType);
    });
  }

  private async applyPaymentUpdate(
    update: { invoiceId: string; externalId: string; status: string; amountPaid?: number },
    processorType: string,
  ): Promise<void> {
    const invoice = await this.invoicesRepository.findById(update.invoiceId);

    if (!invoice) {
      this.logger.warn(`Webhook referenced unknown invoice ${update.invoiceId}`);

      return;
    }

    const attempt = await this.paymentAttemptsRepository.findByExternalId(processorType, update.externalId);

    if (update.status === 'succeeded') {
      await this.invoicesRepository.update(invoice.id, {
        status: InvoiceStatus.PAID,
        balanceDue: 0,
      });

      if (attempt) {
        await this.paymentAttemptsRepository.update(attempt.id, { status: PaymentAttemptStatus.SUCCEEDED });
      }

      await this.auditLog.log({
        process: 'payment.webhook',
        level: 'info',
        message: 'Invoice marked paid',
        invoiceId: invoice.id,
        userId: invoice.userId,
        context: { externalId: update.externalId },
      });

      return;
    }

    if (update.status === 'canceled' && attempt) {
      await this.paymentAttemptsRepository.update(attempt.id, { status: PaymentAttemptStatus.CANCELED });
    }
  }
}
