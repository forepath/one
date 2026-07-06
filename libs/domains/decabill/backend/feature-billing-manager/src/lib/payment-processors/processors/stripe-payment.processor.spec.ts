const checkoutSessionsCreate = jest.fn();

jest.mock('stripe', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    checkout: { sessions: { create: checkoutSessionsCreate } },
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

  it('maps checkout.session.completed to succeeded when payment is paid', () => {
    expect(
      processor.mapWebhookToPaymentUpdate({
        type: 'checkout.session.completed',
        data: { object: { ...sessionPayload.object, payment_status: 'paid' } },
      }),
    ).toEqual({
      invoiceId: 'inv-1',
      externalId: 'cs_test',
      status: 'succeeded',
      amountPaid: 99.5,
      tenantId: 'forepath',
    });
  });

  it('ignores checkout.session.completed while async payment is still unpaid', () => {
    expect(
      processor.mapWebhookToPaymentUpdate({
        type: 'checkout.session.completed',
        data: { object: { ...sessionPayload.object, payment_status: 'unpaid' } },
      }),
    ).toBeNull();
  });

  it('maps checkout.session.async_payment_succeeded to succeeded', () => {
    expect(
      processor.mapWebhookToPaymentUpdate({
        type: 'checkout.session.async_payment_succeeded',
        data: sessionPayload,
      }),
    ).toEqual({
      invoiceId: 'inv-1',
      externalId: 'cs_test',
      status: 'succeeded',
      amountPaid: 99.5,
      tenantId: 'forepath',
    });
  });

  it('maps checkout.session.async_payment_failed to failed', () => {
    expect(
      processor.mapWebhookToPaymentUpdate({
        type: 'checkout.session.async_payment_failed',
        data: sessionPayload,
      }),
    ).toEqual({
      invoiceId: 'inv-1',
      externalId: 'cs_test',
      status: 'failed',
      amountPaid: undefined,
      tenantId: 'forepath',
    });
  });

  it('maps checkout.session.expired to canceled', () => {
    expect(
      processor.mapWebhookToPaymentUpdate({
        type: 'checkout.session.expired',
        data: sessionPayload,
      }),
    ).toEqual({
      invoiceId: 'inv-1',
      externalId: 'cs_test',
      status: 'canceled',
      amountPaid: undefined,
      tenantId: 'forepath',
    });
  });
});
