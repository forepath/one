import { BadRequestException } from '@nestjs/common';

import { AutoPaymentStatus } from '../constants/auto-payment-status.constants';
import { InvoiceStatus } from '../constants/invoice-status.constants';
import { PaymentAttemptStatus } from '../entities/payment-attempt.entity';
import { PaymentProcessorFactory } from '../payment-processors/payment-processor.factory';
import type { PaymentProcessor } from '../payment-processors/payment-processor.interface';

import { AutoBillingService } from './auto-billing.service';
import { CustomerProfilesService } from './customer-profiles.service';

describe('AutoBillingService', () => {
  const customerProfilesRepository = {
    findByUserId: jest.fn(),
    update: jest.fn(),
  };
  const invoicesRepository = {
    findById: jest.fn(),
    update: jest.fn(),
    findOpenOverdueByUserId: jest.fn(),
    findIdsDueForAutoPayment: jest.fn(),
    claimForAutoPayment: jest.fn(),
    transitionAutoPaymentFromInProgress: jest.fn(),
  };
  const paymentAttemptsRepository = {
    create: jest.fn(),
  };
  const auditLog = { log: jest.fn() };
  const billingNotificationPublisher = {
    publish: jest.fn(),
    publishPayment: jest.fn(),
  };
  const billingEmailPublisher = {
    publishPaymentSucceeded: jest.fn(),
  };
  const customerProfilesService = {
    isProfileComplete: jest.fn().mockReturnValue(true),
  };
  let processor: jest.Mocked<PaymentProcessor>;
  let factory: PaymentProcessorFactory;
  let service: AutoBillingService;

  const completeProfileBase = {
    id: 'p1',
    userId: 'u1',
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.com',
    addressLine1: '1 Street',
    postalCode: '10115',
    city: 'Berlin',
    country: 'DE',
    stripeCustomerId: 'cus_1',
    defaultPaymentMethodExternalId: 'pm_1',
  };

  beforeEach(() => {
    jest.resetAllMocks();
    customerProfilesService.isProfileComplete.mockReturnValue(true);
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
    service = new AutoBillingService(
      customerProfilesRepository as never,
      customerProfilesService as unknown as CustomerProfilesService,
      invoicesRepository as never,
      paymentAttemptsRepository as never,
      factory,
      auditLog as never,
      billingNotificationPublisher as never,
      billingEmailPublisher as never,
    );
  });

  it('rejects enable when payment method is missing', async () => {
    customerProfilesRepository.findByUserId.mockResolvedValue({
      id: 'p1',
      userId: 'u1',
      stripeCustomerId: 'cus_1',
    });

    await expect(service.enableForUser('u1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects enable when customer profile is incomplete', async () => {
    customerProfilesRepository.findByUserId.mockResolvedValue({
      ...completeProfileBase,
      firstName: undefined,
    });
    customerProfilesService.isProfileComplete.mockReturnValue(false);

    await expect(service.enableForUser('u1')).rejects.toThrow(
      'Customer profile must be complete before using auto-billing',
    );
  });

  it('rejects setup when customer profile is incomplete', async () => {
    customerProfilesRepository.findByUserId.mockResolvedValue({
      ...completeProfileBase,
      city: undefined,
    });
    customerProfilesService.isProfileComplete.mockReturnValue(false);

    await expect(service.createSetupSessionForUser('u1')).rejects.toThrow(
      'Customer profile must be complete before using auto-billing',
    );
    expect(processor.createSetupSession).not.toHaveBeenCalled();
  });

  it('enables auto-billing and reschedules open invoices', async () => {
    const enabledProfile = {
      ...completeProfileBase,
      autoBillingEnabled: true,
    };

    customerProfilesRepository.findByUserId
      .mockResolvedValueOnce(completeProfileBase)
      .mockResolvedValue(enabledProfile);
    customerProfilesRepository.update.mockResolvedValue(enabledProfile);
    invoicesRepository.findOpenOverdueByUserId.mockResolvedValue([
      {
        id: 'inv-1',
        userId: 'u1',
        status: InvoiceStatus.ISSUED,
        balanceDue: 10,
        paymentProcessor: 'stripe',
      },
    ]);
    invoicesRepository.update.mockResolvedValue({});

    await service.enableForUser('u1');

    expect(customerProfilesRepository.update).toHaveBeenCalledWith('p1', { autoBillingEnabled: true });
    expect(billingNotificationPublisher.publish).toHaveBeenCalledWith('auto_billing.enabled', expect.any(Object), 'u1');
    expect(invoicesRepository.update).toHaveBeenCalledWith(
      'inv-1',
      expect.objectContaining({ autoPaymentStatus: AutoPaymentStatus.SCHEDULED }),
    );
  });

  it('does not schedule auto-payment when profile is incomplete', async () => {
    customerProfilesRepository.findByUserId.mockResolvedValue({
      ...completeProfileBase,
      autoBillingEnabled: true,
    });
    customerProfilesService.isProfileComplete.mockReturnValue(false);

    await service.scheduleIfEligible({
      id: 'inv-1',
      userId: 'u1',
      status: InvoiceStatus.ISSUED,
      balanceDue: 10,
      paymentProcessor: 'stripe',
    } as never);

    expect(invoicesRepository.update).not.toHaveBeenCalled();
  });

  it('disables auto-billing and cancels scheduled/retrying but not in-progress', async () => {
    customerProfilesRepository.findByUserId.mockResolvedValue({ id: 'p1', userId: 'u1' });
    customerProfilesRepository.update.mockResolvedValue({ id: 'p1', userId: 'u1', autoBillingEnabled: false });
    invoicesRepository.findOpenOverdueByUserId.mockResolvedValue([
      { id: 'inv-1', autoPaymentStatus: AutoPaymentStatus.RETRYING },
      { id: 'inv-2', autoPaymentStatus: AutoPaymentStatus.IN_PROGRESS },
      { id: 'inv-3', autoPaymentStatus: AutoPaymentStatus.SCHEDULED },
    ]);
    invoicesRepository.update.mockResolvedValue({});

    await service.disableForUser('u1');

    expect(invoicesRepository.update).toHaveBeenCalledWith('inv-1', {
      autoPaymentStatus: AutoPaymentStatus.CANCELED,
      autoPaymentNextRetryAt: null,
    });
    expect(invoicesRepository.update).toHaveBeenCalledWith('inv-3', {
      autoPaymentStatus: AutoPaymentStatus.CANCELED,
      autoPaymentNextRetryAt: null,
    });
    expect(invoicesRepository.update).not.toHaveBeenCalledWith(
      'inv-2',
      expect.objectContaining({ autoPaymentStatus: AutoPaymentStatus.CANCELED }),
    );
    expect(billingNotificationPublisher.publish).toHaveBeenCalledWith(
      'auto_billing.disabled',
      expect.any(Object),
      'u1',
    );
  });

  it('charges off-session and marks invoice paid on success', async () => {
    const invoice = {
      id: 'inv-1',
      userId: 'u1',
      status: InvoiceStatus.ISSUED,
      balanceDue: 50,
      currency: 'EUR',
      invoiceNumber: 'INV-1',
      paymentProcessor: 'stripe',
      autoPaymentStatus: AutoPaymentStatus.SCHEDULED,
      autoPaymentAttemptCount: 0,
    };

    invoicesRepository.findById.mockResolvedValue(invoice);
    invoicesRepository.claimForAutoPayment.mockResolvedValue({
      ...invoice,
      autoPaymentStatus: AutoPaymentStatus.IN_PROGRESS,
      autoPaymentAttemptCount: 1,
    });
    customerProfilesRepository.findByUserId.mockResolvedValue({
      ...completeProfileBase,
      autoBillingEnabled: true,
    });
    processor.chargeOffSession.mockResolvedValue({ externalId: 'pi_1', status: 'succeeded' });
    invoicesRepository.update.mockImplementation(async (_id, patch) => ({ id: 'inv-1', ...patch }));

    await service.attemptAutoPayment('inv-1');

    expect(invoicesRepository.claimForAutoPayment).toHaveBeenCalledWith('inv-1', 1);
    expect(paymentAttemptsRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        status: PaymentAttemptStatus.SUCCEEDED,
        metadata: expect.objectContaining({ kind: 'auto' }),
      }),
    );
    expect(billingNotificationPublisher.publishPayment).toHaveBeenCalledWith(
      'payment.succeeded',
      expect.any(Object),
      expect.objectContaining({ mode: 'auto' }),
    );
  });

  it('defers auto-payment with a future nextRetryAt when profile becomes incomplete', async () => {
    invoicesRepository.findById.mockResolvedValue({
      id: 'inv-1',
      userId: 'u1',
      status: InvoiceStatus.ISSUED,
      balanceDue: 50,
      currency: 'EUR',
      paymentProcessor: 'stripe',
      autoPaymentStatus: AutoPaymentStatus.SCHEDULED,
      autoPaymentAttemptCount: 0,
    });
    customerProfilesRepository.findByUserId.mockResolvedValue({
      ...completeProfileBase,
      autoBillingEnabled: true,
      city: undefined,
    });
    customerProfilesService.isProfileComplete.mockReturnValue(false);
    invoicesRepository.update.mockResolvedValue({});

    await service.attemptAutoPayment('inv-1');

    expect(processor.chargeOffSession).not.toHaveBeenCalled();
    expect(invoicesRepository.update).toHaveBeenCalledWith(
      'inv-1',
      expect.objectContaining({
        autoPaymentNextRetryAt: expect.any(Date),
      }),
    );
    expect(paymentAttemptsRepository.create).not.toHaveBeenCalled();
  });

  it('keeps pending charges in progress with a safety nextRetryAt', async () => {
    const invoice = {
      id: 'inv-1',
      userId: 'u1',
      status: InvoiceStatus.ISSUED,
      balanceDue: 50,
      currency: 'EUR',
      paymentProcessor: 'stripe',
      autoPaymentStatus: AutoPaymentStatus.SCHEDULED,
      autoPaymentAttemptCount: 0,
    };

    invoicesRepository.findById.mockResolvedValue(invoice);
    invoicesRepository.claimForAutoPayment.mockResolvedValue({
      ...invoice,
      autoPaymentStatus: AutoPaymentStatus.IN_PROGRESS,
      autoPaymentAttemptCount: 1,
    });
    customerProfilesRepository.findByUserId.mockResolvedValue({
      ...completeProfileBase,
      autoBillingEnabled: true,
    });
    processor.chargeOffSession.mockResolvedValue({ externalId: 'pi_pending', status: 'pending' });
    invoicesRepository.update.mockResolvedValue({});

    await service.attemptAutoPayment('inv-1');

    expect(invoicesRepository.update).toHaveBeenCalledWith(
      'inv-1',
      expect.objectContaining({
        autoPaymentNextRetryAt: expect.any(Date),
      }),
    );
    expect(invoicesRepository.transitionAutoPaymentFromInProgress).not.toHaveBeenCalled();
  });

  it('releases stuck in-progress charges after the safety timeout', async () => {
    const invoice = {
      id: 'inv-1',
      userId: 'u1',
      status: InvoiceStatus.ISSUED,
      balanceDue: 50,
      currency: 'EUR',
      paymentProcessor: 'stripe',
      autoPaymentStatus: AutoPaymentStatus.IN_PROGRESS,
      autoPaymentAttemptCount: 1,
      autoPaymentNextRetryAt: new Date(Date.now() - 1000),
    };

    invoicesRepository.findById.mockResolvedValue(invoice);
    invoicesRepository.transitionAutoPaymentFromInProgress.mockResolvedValue(true);
    invoicesRepository.claimForAutoPayment.mockResolvedValue({
      ...invoice,
      autoPaymentStatus: AutoPaymentStatus.IN_PROGRESS,
      autoPaymentAttemptCount: 1,
      autoPaymentNextRetryAt: null,
    });
    customerProfilesRepository.findByUserId.mockResolvedValue({
      ...completeProfileBase,
      autoBillingEnabled: true,
    });
    processor.chargeOffSession.mockResolvedValue({ externalId: 'pi_2', status: 'succeeded' });
    invoicesRepository.update.mockImplementation(async (_id, patch) => ({ id: 'inv-1', ...patch }));

    await service.attemptAutoPayment('inv-1');

    expect(invoicesRepository.transitionAutoPaymentFromInProgress).toHaveBeenCalledWith(
      'inv-1',
      expect.objectContaining({
        autoPaymentStatus: AutoPaymentStatus.RETRYING,
        autoPaymentAttemptCount: 0,
      }),
    );
    expect(invoicesRepository.claimForAutoPayment).toHaveBeenCalled();
    expect(processor.chargeOffSession).toHaveBeenCalled();
  });

  it('skips charging when claim is lost to another worker', async () => {
    invoicesRepository.findById.mockResolvedValue({
      id: 'inv-1',
      userId: 'u1',
      status: InvoiceStatus.ISSUED,
      balanceDue: 50,
      currency: 'EUR',
      paymentProcessor: 'stripe',
      autoPaymentStatus: AutoPaymentStatus.SCHEDULED,
      autoPaymentAttemptCount: 0,
    });
    customerProfilesRepository.findByUserId.mockResolvedValue({
      ...completeProfileBase,
      autoBillingEnabled: true,
    });
    invoicesRepository.claimForAutoPayment.mockResolvedValue(null);

    await service.attemptAutoPayment('inv-1');

    expect(processor.chargeOffSession).not.toHaveBeenCalled();
    expect(paymentAttemptsRepository.create).not.toHaveBeenCalled();
  });

  it('schedules retry on first failure', async () => {
    const invoice = {
      id: 'inv-1',
      userId: 'u1',
      status: InvoiceStatus.ISSUED,
      balanceDue: 50,
      currency: 'EUR',
      paymentProcessor: 'stripe',
      autoPaymentStatus: AutoPaymentStatus.SCHEDULED,
      autoPaymentAttemptCount: 0,
    };

    invoicesRepository.findById.mockResolvedValue(invoice);
    invoicesRepository.claimForAutoPayment.mockResolvedValue({
      ...invoice,
      autoPaymentStatus: AutoPaymentStatus.IN_PROGRESS,
      autoPaymentAttemptCount: 1,
    });
    invoicesRepository.transitionAutoPaymentFromInProgress.mockResolvedValue(true);
    customerProfilesRepository.findByUserId.mockResolvedValue({
      ...completeProfileBase,
      autoBillingEnabled: true,
    });
    processor.chargeOffSession.mockResolvedValue({ externalId: 'pi_fail', status: 'failed' });
    invoicesRepository.update.mockResolvedValue({});

    await service.attemptAutoPayment('inv-1');

    expect(billingNotificationPublisher.publish).toHaveBeenCalledWith(
      'payment.auto.retry_scheduled',
      expect.objectContaining({ invoiceId: 'inv-1' }),
      'u1',
    );
    expect(invoicesRepository.transitionAutoPaymentFromInProgress).toHaveBeenCalledWith(
      'inv-1',
      expect.objectContaining({ autoPaymentStatus: AutoPaymentStatus.RETRYING }),
    );
  });

  it('skips duplicate failure handling when transition loses the race', async () => {
    const invoice = {
      id: 'inv-1',
      userId: 'u1',
      autoPaymentAttemptCount: 1,
    };

    invoicesRepository.transitionAutoPaymentFromInProgress.mockResolvedValue(false);

    await service.onAutoPaymentFailed(invoice as never, 1, 'stripe', 'pi_fail');

    expect(billingNotificationPublisher.publishPayment).not.toHaveBeenCalled();
    expect(billingNotificationPublisher.publish).not.toHaveBeenCalled();
  });
});
