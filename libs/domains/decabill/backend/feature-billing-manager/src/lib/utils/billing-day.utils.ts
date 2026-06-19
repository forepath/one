const MAX_BILLING_DAY = 28;

/**
 * Returns the effective billing day (1-28) for a user.
 * Uses billingDayOfMonth when set (1-28), otherwise the day of month of createdAt, capped at 28.
 */
export function getEffectiveBillingDay(createdAt: Date, billingDayOfMonth?: number | null): number {
  if (billingDayOfMonth != null && billingDayOfMonth >= 1 && billingDayOfMonth <= MAX_BILLING_DAY) {
    return billingDayOfMonth;
  }

  const day = createdAt.getUTCDate();

  return day > MAX_BILLING_DAY ? MAX_BILLING_DAY : day;
}

/**
 * Returns today's day of month for billing comparison (1-28). Days 29-31 are treated as 28.
 */
export function getTodayBillingDay(): number {
  const now = new Date();
  const day = now.getUTCDate();

  return day > MAX_BILLING_DAY ? MAX_BILLING_DAY : day;
}
