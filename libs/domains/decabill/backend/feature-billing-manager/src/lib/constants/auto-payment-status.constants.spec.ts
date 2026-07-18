import {
  AUTO_PAYMENT_MAX_ATTEMPTS,
  AutoPaymentStatus,
  getAutoPaymentPendingSafetyDelayMs,
  isAutoPaymentBlocking,
} from './auto-payment-status.constants';

describe('auto-payment-status.constants', () => {
  it('blocks only in_progress and retrying (not scheduled)', () => {
    expect(isAutoPaymentBlocking(AutoPaymentStatus.SCHEDULED)).toBe(false);
    expect(isAutoPaymentBlocking(AutoPaymentStatus.IN_PROGRESS)).toBe(true);
    expect(isAutoPaymentBlocking(AutoPaymentStatus.RETRYING)).toBe(true);
    expect(isAutoPaymentBlocking(AutoPaymentStatus.EXHAUSTED)).toBe(false);
    expect(isAutoPaymentBlocking(AutoPaymentStatus.CANCELED)).toBe(false);
    expect(isAutoPaymentBlocking(undefined)).toBe(false);
  });

  it('uses three max attempts', () => {
    expect(AUTO_PAYMENT_MAX_ATTEMPTS).toBe(3);
  });

  it('defaults pending safety delay to 15 minutes', () => {
    const previous = process.env.BILLING_AUTO_PAYMENT_PENDING_SAFETY_DELAY_MS;
    delete process.env.BILLING_AUTO_PAYMENT_PENDING_SAFETY_DELAY_MS;

    expect(getAutoPaymentPendingSafetyDelayMs()).toBe(900_000);

    if (previous === undefined) {
      delete process.env.BILLING_AUTO_PAYMENT_PENDING_SAFETY_DELAY_MS;
    } else {
      process.env.BILLING_AUTO_PAYMENT_PENDING_SAFETY_DELAY_MS = previous;
    }
  });
});
