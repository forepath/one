import { PaymentProcessorFactory } from './payment-processor.factory';
import type { PaymentProcessor } from './payment-processor.interface';

describe('PaymentProcessorFactory', () => {
  it('registers and resolves processors', () => {
    const factory = new PaymentProcessorFactory();
    const processor: PaymentProcessor = {
      getType: () => 'stripe',
      getDisplayName: () => 'Stripe',
      createCheckoutSession: jest.fn(),
      verifyWebhookSignature: jest.fn(),
      parseWebhookEvent: jest.fn(),
      mapWebhookToPaymentUpdate: jest.fn(),
      refundPayment: jest.fn(),
    };

    factory.registerProcessor(processor);

    expect(factory.getProcessor('stripe')).toBe(processor);
    expect(factory.getRegisteredTypes()).toEqual(['stripe']);
  });
});
