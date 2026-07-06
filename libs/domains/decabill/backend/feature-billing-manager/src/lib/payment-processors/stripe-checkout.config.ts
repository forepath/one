import { parseBooleanEnv } from '../utils/datev-format.util';

export const STRIPE_CHECKOUT_FRAUD_PROTECTION_ENV = 'STRIPE_CHECKOUT_FRAUD_PROTECTION_ENABLED';

export function isStripeCheckoutFraudProtectionEnabled(): boolean {
  return parseBooleanEnv(STRIPE_CHECKOUT_FRAUD_PROTECTION_ENV, true);
}
