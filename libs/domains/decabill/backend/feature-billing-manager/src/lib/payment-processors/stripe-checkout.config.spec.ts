import { STRIPE_CHECKOUT_FRAUD_PROTECTION_ENV, isStripeCheckoutFraudProtectionEnabled } from './stripe-checkout.config';

describe('stripe-checkout.config', () => {
  const originalValue = process.env[STRIPE_CHECKOUT_FRAUD_PROTECTION_ENV];

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env[STRIPE_CHECKOUT_FRAUD_PROTECTION_ENV];
    } else {
      process.env[STRIPE_CHECKOUT_FRAUD_PROTECTION_ENV] = originalValue;
    }
  });

  it('enables fraud protection by default when env is unset', () => {
    delete process.env[STRIPE_CHECKOUT_FRAUD_PROTECTION_ENV];

    expect(isStripeCheckoutFraudProtectionEnabled()).toBe(true);
  });

  it('disables fraud protection when env is false', () => {
    process.env[STRIPE_CHECKOUT_FRAUD_PROTECTION_ENV] = 'false';

    expect(isStripeCheckoutFraudProtectionEnabled()).toBe(false);
  });

  it('enables fraud protection when env is true', () => {
    process.env[STRIPE_CHECKOUT_FRAUD_PROTECTION_ENV] = 'true';

    expect(isStripeCheckoutFraudProtectionEnabled()).toBe(true);
  });
});
