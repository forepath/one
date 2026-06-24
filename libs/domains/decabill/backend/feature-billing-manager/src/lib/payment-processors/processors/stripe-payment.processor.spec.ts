jest.mock('stripe', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    checkout: { sessions: { create: jest.fn() } },
    webhooks: { constructEvent: jest.fn() },
  })),
}));

import { StripePaymentProcessor } from './stripe-payment.processor';

describe('StripePaymentProcessor', () => {
  let processor: StripePaymentProcessor;

  beforeEach(() => {
    processor = new StripePaymentProcessor();
  });

  const sessionPayload = {
    object: {
      id: 'cs_test',
      client_reference_id: 'inv-1',
      amount_total: 9950,
      metadata: { tenantId: 'forepath', invoiceId: 'inv-1' },
    },
  };

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
