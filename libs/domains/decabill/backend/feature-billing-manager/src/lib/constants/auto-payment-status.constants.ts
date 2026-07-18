export enum AutoPaymentStatus {
  IDLE = 'idle',
  SCHEDULED = 'scheduled',
  IN_PROGRESS = 'in_progress',
  RETRYING = 'retrying',
  SUCCEEDED = 'succeeded',
  EXHAUSTED = 'exhausted',
  CANCELED = 'canceled',
}

/** Statuses that block customer-initiated Checkout payment. */
export const AUTO_PAYMENT_BLOCKING_STATUSES: AutoPaymentStatus[] = [
  AutoPaymentStatus.IN_PROGRESS,
  AutoPaymentStatus.RETRYING,
];

export const AUTO_PAYMENT_MAX_ATTEMPTS = 3;

/** Safety delay before re-attempting a pending (e.g. SCA) off-session charge. Default 15 minutes. */
export function getAutoPaymentPendingSafetyDelayMs(): number {
  return parseIntervalMs('BILLING_AUTO_PAYMENT_PENDING_SAFETY_DELAY_MS', 900_000);
}

/** Delay before attempt index 1 and 2 (0-based attempt after first failure). Defaults: 1 day, 3 days. */
export function getAutoPaymentRetryDelayMs(attemptAfterFailure: number): number {
  if (attemptAfterFailure <= 0) {
    return parseIntervalMs('BILLING_AUTO_PAYMENT_RETRY_DELAY_1_MS', 86_400_000);
  }

  return parseIntervalMs('BILLING_AUTO_PAYMENT_RETRY_DELAY_2_MS', 259_200_000);
}

function parseIntervalMs(envKey: string, fallback: number): number {
  const parsed = parseInt(process.env[envKey] ?? String(fallback), 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function isAutoPaymentBlocking(status: AutoPaymentStatus | string | null | undefined): boolean {
  if (!status) {
    return false;
  }

  return AUTO_PAYMENT_BLOCKING_STATUSES.includes(status as AutoPaymentStatus);
}
