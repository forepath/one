export const STATUTORY_WITHDRAWAL_PERIOD_DAYS_ENV = 'BILLING_STATUTORY_WITHDRAWAL_PERIOD_DAYS';

export function getStatutoryWithdrawalPeriodDays(): number {
  const raw = process.env[STATUTORY_WITHDRAWAL_PERIOD_DAYS_ENV];
  const parsed = raw ? parseInt(raw, 10) : 14;

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 14;
}
