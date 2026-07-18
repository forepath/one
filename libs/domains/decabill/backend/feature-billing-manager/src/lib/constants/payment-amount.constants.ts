const DEFAULT_MIN_CHECKOUT_PAYMENT_AMOUNT = 1;

/**
 * Minimum balance due that can be charged via Checkout or saved payment method.
 * Set via `BILLING_MIN_CHECKOUT_PAYMENT_AMOUNT`; falls back to 1 when unset or invalid.
 */
export function getMinCheckoutPaymentAmount(
  envValue: string | undefined = process.env['BILLING_MIN_CHECKOUT_PAYMENT_AMOUNT'],
): number {
  if (envValue == null || envValue.trim() === '') {
    return DEFAULT_MIN_CHECKOUT_PAYMENT_AMOUNT;
  }

  const parsed = Number(envValue);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_MIN_CHECKOUT_PAYMENT_AMOUNT;
  }

  return parsed;
}
