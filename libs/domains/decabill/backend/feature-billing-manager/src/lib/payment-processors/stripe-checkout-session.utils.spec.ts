import {
  buildStripeCheckoutSessionCreateParams,
  buildStripeSetupSessionCreateParams,
} from './stripe-checkout-session.utils';

describe('buildStripeCheckoutSessionCreateParams', () => {
  const baseParams = {
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
      tenantId: 'default',
    },
  };

  it('includes Radar-driven 3DS options when fraud protection is enabled', () => {
    expect(buildStripeCheckoutSessionCreateParams(baseParams, { fraudProtectionEnabled: true })).toMatchObject({
      payment_method_options: {
        card: {
          request_three_d_secure: 'automatic',
        },
      },
    });
  });

  it('omits fraud protection options when disabled', () => {
    const params = buildStripeCheckoutSessionCreateParams(baseParams, { fraudProtectionEnabled: false });

    expect(params).not.toHaveProperty('payment_method_options');
  });

  it('includes setup_future_usage on payment intents', () => {
    expect(buildStripeCheckoutSessionCreateParams(baseParams, { fraudProtectionEnabled: false })).toMatchObject({
      payment_intent_data: {
        setup_future_usage: 'off_session',
      },
    });
  });

  it('builds setup session params with customer and setup_intent metadata', () => {
    expect(
      buildStripeSetupSessionCreateParams({
        stripeCustomerId: 'cus_1',
        currency: 'EUR',
        successUrl: 'https://example.com/ok',
        cancelUrl: 'https://example.com/cancel',
        idempotencyKey: 'k',
        metadata: { userId: 'u1', tenantId: 'default' },
      }),
    ).toMatchObject({
      mode: 'setup',
      currency: 'eur',
      customer: 'cus_1',
      setup_intent_data: {
        metadata: { userId: 'u1', tenantId: 'default' },
      },
    });
  });
});
