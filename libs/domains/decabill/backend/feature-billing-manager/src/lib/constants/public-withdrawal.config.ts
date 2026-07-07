export const PUBLIC_WITHDRAWAL_CONFIRMATION_TTL_HOURS_ENV = 'PUBLIC_WITHDRAWAL_CONFIRMATION_TTL_HOURS';

const DEFAULT_TTL_HOURS = 48;

export function getPublicWithdrawalConfirmationTtlHours(): number {
  const raw = process.env[PUBLIC_WITHDRAWAL_CONFIRMATION_TTL_HOURS_ENV];
  const parsed = raw ? parseInt(raw, 10) : DEFAULT_TTL_HOURS;

  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TTL_HOURS;
}

export function computePublicWithdrawalExpiresAt(now: Date = new Date()): Date {
  const expiresAt = new Date(now);

  expiresAt.setHours(expiresAt.getHours() + getPublicWithdrawalConfirmationTtlHours());

  return expiresAt;
}
