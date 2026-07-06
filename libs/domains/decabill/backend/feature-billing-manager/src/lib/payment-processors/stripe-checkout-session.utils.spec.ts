import { buildStripeCheckoutSessionCreateParams } from './stripe-checkout-session.utils';

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

  it('uses stripe customer id when present', () => {
    expect(
      buildStripeCheckoutSessionCreateParams(
        { ...baseParams, stripeCustomerId: 'cus_123', customerEmail: undefined },
        { fraudProtectionEnabled: true },
      ),
    ).toMatchObject({
      customer: 'cus_123',
    });
    expect(
      buildStripeCheckoutSessionCreateParams(
        { ...baseParams, stripeCustomerId: 'cus_123', customerEmail: undefined },
        { fraudProtectionEnabled: true },
      ),
    ).not.toHaveProperty('customer_email');
  });
});
