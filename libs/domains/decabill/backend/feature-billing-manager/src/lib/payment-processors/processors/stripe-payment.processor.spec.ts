const checkoutSessionsCreate = jest.fn();
const checkoutSessionsRetrieve = jest.fn();
const refundsCreate = jest.fn();
const customersCreate = jest.fn();
const paymentIntentsCreate = jest.fn();

jest.mock('stripe', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    checkout: {
      sessions: {
        create: checkoutSessionsCreate,
        retrieve: checkoutSessionsRetrieve,
      },
    },
    customers: { create: customersCreate },
    paymentIntents: { create: paymentIntentsCreate },
    refunds: { create: refundsCreate },
    webhooks: { constructEvent: jest.fn() },
  })),
}));

import { STRIPE_CHECKOUT_FRAUD_PROTECTION_ENV } from '../stripe-checkout.config';
import { StripePaymentProcessor } from './stripe-payment.processor';

describe('StripePaymentProcessor', () => {
  let processor: StripePaymentProcessor;
  const originalSecretKey = process.env.STRIPE_SECRET_KEY;
  const originalFraudProtection = process.env[STRIPE_CHECKOUT_FRAUD_PROTECTION_ENV];

  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_example';
    checkoutSessionsCreate.mockReset();
    checkoutSessionsRetrieve.mockReset();
    refundsCreate.mockReset();
    customersCreate.mockReset();
    paymentIntentsCreate.mockReset();
    processor = new StripePaymentProcessor();
  });

  afterEach(() => {
    if (originalSecretKey === undefined) {
      delete process.env.STRIPE_SECRET_KEY;
    } else {
      process.env.STRIPE_SECRET_KEY = originalSecretKey;
    }

    if (originalFraudProtection === undefined) {
      delete process.env[STRIPE_CHECKOUT_FRAUD_PROTECTION_ENV];
    } else {
      process.env[STRIPE_CHECKOUT_FRAUD_PROTECTION_ENV] = originalFraudProtection;
    }
  });

  const sessionPayload = {
    object: {
      id: 'cs_test',
      client_reference_id: 'inv-1',
      amount_total: 9950,
      metadata: { tenantId: 'forepath', invoiceId: 'inv-1' },
    },
  };

  const checkoutParams = {
    invoiceId: 'inv-1',
    amount: 99.5,
    currency: 'EUR',
    customerEmail: 'customer@example.com',
    successUrl: 'https://billing.example.com/success',
    cancelUrl: 'https://billing.example.com/cancel',
    idempotencyKey: 'pay-inv-1',
    metadata: {
      invoiceId: 'inv-1',
      subscriptionId: 'sub-1',
      userId: 'user-1',
      invoiceNumber: 'INV-001',
      tenantId: 'forepath',
    },
  };

  it('reports auto-payment support', () => {
    expect(processor.supportsAutoPayment()).toBe(true);
  });

  it('creates checkout sessions with Radar-driven 3DS when fraud protection is enabled', async () => {
    delete process.env[STRIPE_CHECKOUT_FRAUD_PROTECTION_ENV];
    checkoutSessionsCreate.mockResolvedValue({ id: 'cs_test', url: 'https://checkout.stripe.test/cs_test' });

    await processor.createCheckoutSession(checkoutParams);

    expect(checkoutSessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        payment_method_options: {
          card: {
            request_three_d_secure: 'automatic',
          },
        },
      }),
      { idempotencyKey: 'pay-inv-1' },
    );
  });

  it('creates checkout sessions without fraud protection options when disabled', async () => {
    process.env[STRIPE_CHECKOUT_FRAUD_PROTECTION_ENV] = 'false';
    checkoutSessionsCreate.mockResolvedValue({ id: 'cs_test', url: 'https://checkout.stripe.test/cs_test' });
    processor = new StripePaymentProcessor();

    await processor.createCheckoutSession(checkoutParams);

    expect(checkoutSessionsCreate).toHaveBeenCalledWith(
      expect.not.objectContaining({
        payment_method_options: expect.anything(),
      }),
      { idempotencyKey: 'pay-inv-1' },
    );
  });

  it('maps checkout.session.completed to succeeded when payment is paid', async () => {
    await expect(
      processor.mapWebhookToPaymentUpdate({
        type: 'checkout.session.completed',
        data: { object: { ...sessionPayload.object, payment_status: 'paid' } },
      }),
    ).resolves.toEqual({
      invoiceId: 'inv-1',
      externalId: 'cs_test',
      status: 'succeeded',
      amountPaid: 99.5,
      tenantId: 'forepath',
      userId: undefined,
      mode: 'checkout',
      paymentMethodExternalId: undefined,
      stripeCustomerId: undefined,
    });
  });

  it('ignores checkout.session.completed while async payment is still unpaid', async () => {
    await expect(
      processor.mapWebhookToPaymentUpdate({
        type: 'checkout.session.completed',
        data: { object: { ...sessionPayload.object, payment_status: 'unpaid' } },
      }),
    ).resolves.toBeNull();
  });

  it('maps checkout.session.async_payment_succeeded to succeeded', async () => {
    await expect(
      processor.mapWebhookToPaymentUpdate({
        type: 'checkout.session.async_payment_succeeded',
        data: sessionPayload,
      }),
    ).resolves.toEqual({
      invoiceId: 'inv-1',
      externalId: 'cs_test',
      status: 'succeeded',
      amountPaid: 99.5,
      tenantId: 'forepath',
      userId: undefined,
      mode: 'checkout',
      paymentMethodExternalId: undefined,
      stripeCustomerId: undefined,
    });
  });

  it('maps checkout.session.async_payment_failed to failed', async () => {
    await expect(
      processor.mapWebhookToPaymentUpdate({
        type: 'checkout.session.async_payment_failed',
        data: sessionPayload,
      }),
    ).resolves.toEqual({
      invoiceId: 'inv-1',
      externalId: 'cs_test',
      status: 'failed',
      amountPaid: undefined,
      tenantId: 'forepath',
      userId: undefined,
      mode: 'checkout',
      paymentMethodExternalId: undefined,
      stripeCustomerId: undefined,
    });
  });

  it('maps checkout.session.expired to canceled', async () => {
    await expect(
      processor.mapWebhookToPaymentUpdate({
        type: 'checkout.session.expired',
        data: sessionPayload,
      }),
    ).resolves.toEqual({
      invoiceId: 'inv-1',
      externalId: 'cs_test',
      status: 'canceled',
      amountPaid: undefined,
      tenantId: 'forepath',
      userId: undefined,
      mode: 'checkout',
      paymentMethodExternalId: undefined,
      stripeCustomerId: undefined,
    });
  });

  it('maps payment_intent.succeeded for auto charges', async () => {
    await expect(
      processor.mapWebhookToPaymentUpdate({
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_1',
            amount: 5000,
            metadata: { invoiceId: 'inv-1', tenantId: 'forepath', mode: 'auto' },
            payment_method: 'pm_1',
          },
        },
      }),
    ).resolves.toEqual({
      invoiceId: 'inv-1',
      externalId: 'pi_1',
      status: 'succeeded',
      amountPaid: 50,
      tenantId: 'forepath',
      userId: undefined,
      mode: 'auto',
      paymentMethodExternalId: 'pm_1',
      stripeCustomerId: undefined,
    });
  });

  it('ignores payment_intent.succeeded for checkout charges', async () => {
    await expect(
      processor.mapWebhookToPaymentUpdate({
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_checkout',
            amount: 5000,
            metadata: { invoiceId: 'inv-1', tenantId: 'forepath', mode: 'checkout' },
            payment_method: 'pm_1',
          },
        },
      }),
    ).resolves.toBeNull();
  });

  it('maps setup checkout.session.completed to setup update', async () => {
    await expect(
      processor.mapWebhookToSetupUpdate({
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_setup',
            mode: 'setup',
            metadata: { tenantId: 'forepath', userId: 'user-1' },
            customer: 'cus_1',
            setup_intent: { id: 'seti_1', payment_method: 'pm_1' },
          },
        },
      }),
    ).resolves.toEqual({
      externalId: 'cs_setup',
      status: 'succeeded',
      tenantId: 'forepath',
      userId: 'user-1',
      paymentMethodExternalId: 'pm_1',
      stripeCustomerId: 'cus_1',
    });
  });

  it('retrieves expanded setup_intent when webhook sends only the id string', async () => {
    checkoutSessionsRetrieve.mockResolvedValue({
      id: 'cs_setup',
      mode: 'setup',
      metadata: { tenantId: 'forepath', userId: 'user-1' },
      customer: 'cus_1',
      setup_intent: { id: 'seti_1', payment_method: 'pm_expanded' },
    });

    await expect(
      processor.mapWebhookToSetupUpdate({
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_setup',
            mode: 'setup',
            metadata: { tenantId: 'forepath', userId: 'user-1' },
            customer: 'cus_1',
            setup_intent: 'seti_1',
          },
        },
      }),
    ).resolves.toEqual({
      externalId: 'cs_setup',
      status: 'succeeded',
      tenantId: 'forepath',
      userId: 'user-1',
      paymentMethodExternalId: 'pm_expanded',
      stripeCustomerId: 'cus_1',
    });
    expect(checkoutSessionsRetrieve).toHaveBeenCalledWith('cs_setup', { expand: ['setup_intent'] });
  });

  it('maps setup_intent.succeeded using setup intent metadata', async () => {
    await expect(
      processor.mapWebhookToSetupUpdate({
        type: 'setup_intent.succeeded',
        data: {
          object: {
            id: 'seti_1',
            payment_method: 'pm_1',
            customer: 'cus_1',
            metadata: { tenantId: 'forepath', userId: 'user-1' },
          },
        },
      }),
    ).resolves.toEqual({
      externalId: 'seti_1',
      status: 'succeeded',
      tenantId: 'forepath',
      userId: 'user-1',
      paymentMethodExternalId: 'pm_1',
      stripeCustomerId: 'cus_1',
    });
  });

  it('refunds payment via checkout session payment intent', async () => {
    checkoutSessionsRetrieve.mockResolvedValue({
      payment_intent: { id: 'pi_test' },
    });
    refundsCreate.mockResolvedValue({ id: 're_test' });

    const result = await processor.refundPayment({
      externalCheckoutSessionId: 'cs_test',
      amount: 49.5,
      currency: 'EUR',
      idempotencyKey: 'withdraw-refund-inv-1',
    });

    expect(checkoutSessionsRetrieve).toHaveBeenCalledWith('cs_test', { expand: ['payment_intent'] });
    expect(refundsCreate).toHaveBeenCalledWith(
      { payment_intent: 'pi_test', amount: 4950 },
      { idempotencyKey: 'withdraw-refund-inv-1' },
    );
    expect(result).toEqual({ externalRefundId: 're_test' });
  });

  it('throws when checkout session has no payment intent', async () => {
    checkoutSessionsRetrieve.mockResolvedValue({ payment_intent: null });

    await expect(
      processor.refundPayment({
        externalCheckoutSessionId: 'cs_test',
        amount: 10,
        currency: 'EUR',
        idempotencyKey: 'key-1',
      }),
    ).rejects.toThrow('Stripe checkout session has no payment intent');
  });
});
