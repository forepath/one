import { getStatutoryWithdrawalPeriodDays, STATUTORY_WITHDRAWAL_PERIOD_DAYS_ENV } from './withdrawal-policy.config';

describe('withdrawal-policy.config', () => {
  const original = process.env[STATUTORY_WITHDRAWAL_PERIOD_DAYS_ENV];

  afterEach(() => {
    if (original === undefined) {
      delete process.env[STATUTORY_WITHDRAWAL_PERIOD_DAYS_ENV];
    } else {
      process.env[STATUTORY_WITHDRAWAL_PERIOD_DAYS_ENV] = original;
    }
  });

  it('defaults to 14 days', () => {
    delete process.env[STATUTORY_WITHDRAWAL_PERIOD_DAYS_ENV];

    expect(getStatutoryWithdrawalPeriodDays()).toBe(14);
  });

  it('reads configured days', () => {
    process.env[STATUTORY_WITHDRAWAL_PERIOD_DAYS_ENV] = '30';

    expect(getStatutoryWithdrawalPeriodDays()).toBe(30);
  });

  it('falls back to 14 for invalid values', () => {
    process.env[STATUTORY_WITHDRAWAL_PERIOD_DAYS_ENV] = 'invalid';

    expect(getStatutoryWithdrawalPeriodDays()).toBe(14);
  });
});
