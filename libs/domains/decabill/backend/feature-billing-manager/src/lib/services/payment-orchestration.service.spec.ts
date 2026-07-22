import { BadRequestException } from '@nestjs/common';
import { runWithTenantId } from '@forepath/shared/backend';

import { AutoPaymentStatus } from '../constants/auto-payment-status.constants';
import { InvoiceStatus } from '../constants/invoice-status.constants';
import { PaymentAttemptStatus } from '../entities/payment-attempt.entity';
import { PaymentProcessorFactory } from '../payment-processors/payment-processor.factory';
import type { PaymentProcessor } from '../payment-processors/payment-processor.interface';

import { PaymentOrchestrationService } from './payment-orchestration.service';

describe('PaymentOrchestrationService', () => {
  const originalTenantFrontendUrls = process.env['TENANT_FRONTEND_URLS'];
  const originalBillingFrontendUrl = process.env['BILLING_FRONTEND_URL'];
  const invoicesRepository = {
    findByIdAndSubscriptionId: jest.fn(),
    findById: jest.fn(),
    findByIdForUser: jest.fn(),
    update: jest.fn(),
  };
  const paymentAttemptsRepository = {
    create: jest.fn(),
    findByExternalId: jest.fn(),
    update: jest.fn(),
  };
  const paymentWebhookEventsRepository = {
    exists: jest.fn(),
    create: jest.fn(),
  };
  const customerProfilesRepository = {
    findByUserId: jest.fn(),
  };
  const auditLog = {
    log: jest.fn(),
  };
  const billingNotificationPublisher = {
    publishPayment: jest.fn(),
    publishInvoice: jest.fn(),
    publishSubscription: jest.fn(),
    publish: jest.fn(),
  };
  const billingEmailPublisher = {
    publishPaymentSucceeded: jest.fn(),
    publishPaymentFailed: jest.fn(),
  };
  let processor: jest.Mocked<PaymentProcessor>;
  let factory: PaymentProcessorFactory;
  let service: PaymentOrchestrationService;
  let autoBillingService: {
    attachPaymentMethod: jest.Mock;
    onAutoPaymentSucceeded: jest.Mock;
    onAutoPaymentFailed: jest.Mock;
    onCheckoutPaymentMethodCaptured: jest.Mock;
  };
  const customerTrustScoreService = {
    triggerRecomputeForUser: jest.fn(),
  };

  beforeEach(() => {
    jest.resetAllMocks();
    delete process.env['TENANT_FRONTEND_URLS'];
    delete process.env['BILLING_FRONTEND_URL'];
    processor = {
      getType: jest.fn().mockReturnValue('stripe'),
      getDisplayName: jest.fn().mockReturnValue('Stripe'),
      supportsAutoPayment: jest.fn().mockReturnValue(true),
      createCheckoutSession: jest.fn(),
      createSetupSession: jest.fn(),
      chargeOffSession: jest.fn(),
      verifyWebhookSignature: jest.fn(),
      parseWebhookEvent: jest.fn(),
      mapWebhookToPaymentUpdate: jest.fn(),
      mapWebhookToSetupUpdate: jest.fn(),
      refundPayment: jest.fn(),
    };
    factory = new PaymentProcessorFactory();
    factory.registerProcessor(processor);
    autoBillingService = {
      attachPaymentMethod: jest.fn(),
      onAutoPaymentSucceeded: jest.fn(),
      onAutoPaymentFailed: jest.fn(),
      onCheckoutPaymentMethodCaptured: jest.fn(),
    };
    service = new PaymentOrchestrationService(
      invoicesRepository as never,
      paymentAttemptsRepository as never,
      paymentWebhookEventsRepository as never,
      customerProfilesRepository as never,
      factory,
      auditLog as never,
      billingNotificationPublisher as never,
      billingEmailPublisher as never,
      autoBillingService as never,
      customerTrustScoreService as never,
    );
  });

  afterEach(() => {
    if (originalTenantFrontendUrls === undefined) {
      delete process.env['TENANT_FRONTEND_URLS'];
    } else {
      process.env['TENANT_FRONTEND_URLS'] = originalTenantFrontendUrls;
    }

    if (originalBillingFrontendUrl === undefined) {
      delete process.env['BILLING_FRONTEND_URL'];
    } else {
      process.env['BILLING_FRONTEND_URL'] = originalBillingFrontendUrl;
    }
  });

  describe('initiatePayment', () => {
    it('blocks manual payment while auto-billing is retrying', async () => {
      invoicesRepository.findByIdAndSubscriptionId.mockResolvedValue({
        id: 'inv-1',
        subscriptionId: 'sub-1',
        userId: 'user-1',
        status: InvoiceStatus.ISSUED,
        balanceDue: 99.5,
        currency: 'EUR',
        autoPaymentStatus: AutoPaymentStatus.RETRYING,
      });

      await expect(service.initiatePayment('inv-1', 'sub-1', 'user-1')).rejects.toBeInstanceOf(BadRequestException);
      expect(processor.createCheckoutSession).not.toHaveBeenCalled();
    });

    it('rejects payment when balance is below the minimum checkout amount', async () => {
      invoicesRepository.findByIdAndSubscriptionId.mockResolvedValue({
        id: 'inv-1',
        subscriptionId: 'sub-1',
        userId: 'user-1',
        status: InvoiceStatus.ISSUED,
        balanceDue: 0.5,
        currency: 'EUR',
      });

      await expect(service.initiatePayment('inv-1', 'sub-1', 'user-1')).rejects.toThrow(
        /Payment is only available for amounts of 1.00 or more/,
      );
      expect(processor.createCheckoutSession).not.toHaveBeenCalled();
    });

    it('creates checkout session and payment attempt', async () => {
      invoicesRepository.findByIdAndSubscriptionId.mockResolvedValue({
        id: 'inv-1',
        subscriptionId: 'sub-1',
        userId: 'user-1',
        status: InvoiceStatus.ISSUED,
        balanceDue: 99.5,
        currency: 'EUR',
        invoiceNumber: 'INV-1',
        paymentProcessor: 'stripe',
      });
      customerProfilesRepository.findByUserId.mockResolvedValue({
        email: 'user@example.com',
        stripeCustomerId: 'cus_1',
      });
      processor.createCheckoutSession.mockResolvedValue({
        checkoutUrl: 'https://checkout.stripe.com/pay',
        externalId: 'cs_1',
      });
      paymentAttemptsRepository.create.mockResolvedValue({ id: 'attempt-1' });
      invoicesRepository.update.mockResolvedValue({});

      const result = await service.initiatePayment('inv-1', 'sub-1', 'user-1');

      expect(result.checkoutUrl).toBe('https://checkout.stripe.com/pay');
      expect(paymentAttemptsRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          invoiceId: 'inv-1',
          processor: 'stripe',
          externalId: 'cs_1',
          status: PaymentAttemptStatus.PENDING,
        }),
      );
    });

    it('rejects payment for wrong user', async () => {
      invoicesRepository.findByIdAndSubscriptionId.mockResolvedValue({
        id: 'inv-1',
        userId: 'other-user',
        status: InvoiceStatus.ISSUED,
        balanceDue: 10,
      });

      await expect(service.initiatePayment('inv-1', 'sub-1', 'user-1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('uses tenant-specific stripe return urls', async () => {
      process.env['BILLING_FRONTEND_URL'] = 'http://localhost:4500';
      process.env['TENANT_FRONTEND_URLS'] = 'acme=https://billing.acme.com';

      invoicesRepository.findByIdAndSubscriptionId.mockResolvedValue({
        id: 'inv-1',
        subscriptionId: 'sub-1',
        userId: 'user-1',
        status: InvoiceStatus.ISSUED,
        balanceDue: 99.5,
        currency: 'EUR',
        invoiceNumber: 'INV-1',
        paymentProcessor: 'stripe',
      });
      customerProfilesRepository.findByUserId.mockResolvedValue({
        email: 'user@example.com',
        stripeCustomerId: 'cus_1',
      });
      processor.createCheckoutSession.mockResolvedValue({
        checkoutUrl: 'https://checkout.stripe.com/pay',
        externalId: 'cs_1',
      });
      paymentAttemptsRepository.create.mockResolvedValue({ id: 'attempt-1' });
      invoicesRepository.update.mockResolvedValue({});

      await runWithTenantId('acme', () => service.initiatePayment('inv-1', 'sub-1', 'user-1'));

      expect(processor.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({
          successUrl: 'https://billing.acme.com/invoices?payment=success&subscriptionId=sub-1&invoiceRefId=inv-1',
          cancelUrl: 'https://billing.acme.com/invoices?payment=cancel&subscriptionId=sub-1&invoiceRefId=inv-1',
          metadata: expect.objectContaining({ tenantId: 'acme' }),
        }),
      );
    });
  });

  describe('initiatePaymentForUser', () => {
    it('creates checkout session for manual invoice without subscription', async () => {
      invoicesRepository.findByIdForUser.mockResolvedValue({
        id: 'inv-manual',
        subscriptionId: null,
        userId: 'user-1',
        status: InvoiceStatus.ISSUED,
        balanceDue: 50,
        currency: 'EUR',
        invoiceNumber: 'INV-M-1',
        paymentProcessor: 'stripe',
      });
      customerProfilesRepository.findByUserId.mockResolvedValue({
        email: 'user@example.com',
        stripeCustomerId: 'cus_1',
      });
      processor.createCheckoutSession.mockResolvedValue({
        checkoutUrl: 'https://checkout.stripe.com/manual',
        externalId: 'cs_manual',
      });
      paymentAttemptsRepository.create.mockResolvedValue({ id: 'attempt-1' });
      invoicesRepository.update.mockResolvedValue({});

      const result = await service.initiatePaymentForUser('inv-manual', 'user-1');

      expect(result.checkoutUrl).toBe('https://checkout.stripe.com/manual');
      expect(processor.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({
          invoiceId: 'inv-manual',
          metadata: expect.objectContaining({ subscriptionId: '', invoiceId: 'inv-manual' }),
        }),
      );
    });
  });

  describe('handleWebhook', () => {
    it('marks invoice paid on succeeded checkout session', async () => {
      processor.verifyWebhookSignature.mockReturnValue(true);
      processor.parseWebhookEvent.mockReturnValue({
        eventId: 'evt_1',
        type: 'checkout.session.completed',
        data: {},
      });
      processor.mapWebhookToPaymentUpdate.mockResolvedValue({
        invoiceId: 'inv-1',
        externalId: 'cs_1',
        status: 'succeeded',
        tenantId: 'default',
      });
      paymentWebhookEventsRepository.exists.mockResolvedValue(false);
      paymentWebhookEventsRepository.create.mockResolvedValue({});
      invoicesRepository.findById.mockResolvedValue({
        id: 'inv-1',
        userId: 'user-1',
      });
      paymentAttemptsRepository.findByExternalId.mockResolvedValue({ id: 'attempt-1' });
      invoicesRepository.update.mockResolvedValue({});
      paymentAttemptsRepository.update.mockResolvedValue({});

      await service.handleWebhook('stripe', Buffer.from('{}'), 'sig');

      expect(invoicesRepository.update).toHaveBeenCalledWith('inv-1', {
        status: InvoiceStatus.PAID,
        balanceDue: 0,
      });
    });

    it('skips duplicate webhook events', async () => {
      processor.verifyWebhookSignature.mockReturnValue(true);
      processor.parseWebhookEvent.mockReturnValue({ eventId: 'evt_1', type: 'x', data: {} });
      paymentWebhookEventsRepository.exists.mockResolvedValue(true);

      await service.handleWebhook('stripe', '{}', 'sig');

      expect(paymentWebhookEventsRepository.create).not.toHaveBeenCalled();
    });

    it('rejects invalid signature', async () => {
      processor.verifyWebhookSignature.mockReturnValue(false);

      await expect(service.handleWebhook('stripe', '{}', undefined)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('marks payment attempt canceled on canceled checkout session', async () => {
      processor.verifyWebhookSignature.mockReturnValue(true);
      processor.parseWebhookEvent.mockReturnValue({
        eventId: 'evt_2',
        type: 'checkout.session.expired',
        data: {},
      });
      processor.mapWebhookToPaymentUpdate.mockResolvedValue({
        invoiceId: 'inv-1',
        externalId: 'cs_1',
        status: 'canceled',
        tenantId: 'default',
      });
      paymentWebhookEventsRepository.exists.mockResolvedValue(false);
      paymentWebhookEventsRepository.create.mockResolvedValue({});
      invoicesRepository.findById.mockResolvedValue({ id: 'inv-1', userId: 'user-1' });
      paymentAttemptsRepository.findByExternalId.mockResolvedValue({ id: 'attempt-1' });
      paymentAttemptsRepository.update.mockResolvedValue({});

      await service.handleWebhook('stripe', Buffer.from('{}'), 'sig');

      expect(paymentAttemptsRepository.update).toHaveBeenCalledWith('attempt-1', {
        status: PaymentAttemptStatus.CANCELED,
      });
      expect(invoicesRepository.update).not.toHaveBeenCalled();
    });

    it('marks payment attempt failed on async payment failure', async () => {
      processor.verifyWebhookSignature.mockReturnValue(true);
      processor.parseWebhookEvent.mockReturnValue({
        eventId: 'evt_3',
        type: 'checkout.session.async_payment_failed',
        data: {},
      });
      processor.mapWebhookToPaymentUpdate.mockResolvedValue({
        invoiceId: 'inv-1',
        externalId: 'cs_1',
        status: 'failed',
        tenantId: 'default',
      });
      paymentWebhookEventsRepository.exists.mockResolvedValue(false);
      paymentWebhookEventsRepository.create.mockResolvedValue({});
      invoicesRepository.findById.mockResolvedValue({ id: 'inv-1', userId: 'user-1' });
      paymentAttemptsRepository.findByExternalId.mockResolvedValue({ id: 'attempt-1' });
      paymentAttemptsRepository.update.mockResolvedValue({});

      await service.handleWebhook('stripe', Buffer.from('{}'), 'sig');

      expect(paymentAttemptsRepository.update).toHaveBeenCalledWith('attempt-1', {
        status: PaymentAttemptStatus.FAILED,
      });
      expect(invoicesRepository.update).not.toHaveBeenCalled();
    });

    it('ignores webhook updates without tenantId metadata', async () => {
      processor.verifyWebhookSignature.mockReturnValue(true);
      processor.parseWebhookEvent.mockReturnValue({
        eventId: 'evt_missing_tenant',
        type: 'checkout.session.completed',
        data: {},
      });
      processor.mapWebhookToPaymentUpdate.mockResolvedValue({
        invoiceId: 'inv-1',
        externalId: 'cs_1',
        status: 'succeeded',
      });
      paymentWebhookEventsRepository.exists.mockResolvedValue(false);
      paymentWebhookEventsRepository.create.mockResolvedValue({});

      await service.handleWebhook('stripe', Buffer.from('{}'), 'sig');

      expect(invoicesRepository.update).not.toHaveBeenCalled();
      expect(paymentWebhookEventsRepository.create).toHaveBeenCalled();
    });

    it('skips duplicate success email when invoice is already paid', async () => {
      processor.verifyWebhookSignature.mockReturnValue(true);
      processor.parseWebhookEvent.mockReturnValue({
        eventId: 'evt_dup',
        type: 'checkout.session.completed',
        data: {},
      });
      processor.mapWebhookToPaymentUpdate.mockResolvedValue({
        invoiceId: 'inv-1',
        externalId: 'cs_1',
        status: 'succeeded',
        tenantId: 'default',
        mode: 'checkout',
        paymentMethodExternalId: 'pm_1',
      });
      paymentWebhookEventsRepository.exists.mockResolvedValue(false);
      paymentWebhookEventsRepository.create.mockResolvedValue({});
      invoicesRepository.findById.mockResolvedValue({
        id: 'inv-1',
        userId: 'user-1',
        status: InvoiceStatus.PAID,
      });
      paymentAttemptsRepository.findByExternalId.mockResolvedValue({
        id: 'attempt-1',
        status: PaymentAttemptStatus.SUCCEEDED,
      });

      await service.handleWebhook('stripe', Buffer.from('{}'), 'sig');

      expect(invoicesRepository.update).not.toHaveBeenCalled();
      expect(billingEmailPublisher.publishPaymentSucceeded).not.toHaveBeenCalled();
      expect(billingNotificationPublisher.publishPayment).not.toHaveBeenCalled();
    });

    it('skips auto failure handling when invoice is no longer in progress', async () => {
      processor.verifyWebhookSignature.mockReturnValue(true);
      processor.parseWebhookEvent.mockReturnValue({
        eventId: 'evt_fail_dup',
        type: 'payment_intent.payment_failed',
        data: {},
      });
      processor.mapWebhookToPaymentUpdate.mockResolvedValue({
        invoiceId: 'inv-1',
        externalId: 'pi_1',
        status: 'failed',
        tenantId: 'default',
        mode: 'auto',
      });
      paymentWebhookEventsRepository.exists.mockResolvedValue(false);
      paymentWebhookEventsRepository.create.mockResolvedValue({});
      invoicesRepository.findById.mockResolvedValue({
        id: 'inv-1',
        userId: 'user-1',
        autoPaymentStatus: AutoPaymentStatus.RETRYING,
        autoPaymentAttemptCount: 1,
      });
      paymentAttemptsRepository.findByExternalId.mockResolvedValue({ id: 'attempt-1' });
      paymentAttemptsRepository.update.mockResolvedValue({});

      await service.handleWebhook('stripe', Buffer.from('{}'), 'sig');

      expect(paymentAttemptsRepository.update).toHaveBeenCalledWith('attempt-1', {
        status: PaymentAttemptStatus.FAILED,
      });
      expect(autoBillingService.onAutoPaymentFailed).not.toHaveBeenCalled();
    });
  });
});
