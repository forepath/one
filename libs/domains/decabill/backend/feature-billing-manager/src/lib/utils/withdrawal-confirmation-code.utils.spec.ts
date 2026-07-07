import {
  generateWithdrawalConfirmationCode,
  validateWithdrawalConfirmationCode,
} from './withdrawal-confirmation-code.utils';

describe('withdrawal-confirmation-code.utils', () => {
  it('generates a 6-character alphanumeric code', () => {
    const code = generateWithdrawalConfirmationCode();

    expect(code).toMatch(/^[A-Z0-9]{6}$/);
  });

  it('validates matching codes with timing-safe compare', () => {
    expect(validateWithdrawalConfirmationCode('ABC123', 'ABC123')).toBe(true);
    expect(validateWithdrawalConfirmationCode('abc123', 'ABC123')).toBe(true);
  });

  it('rejects invalid format or mismatch', () => {
    expect(validateWithdrawalConfirmationCode('ABC12', 'ABC123')).toBe(false);
    expect(validateWithdrawalConfirmationCode('ABC123', 'ABC124')).toBe(false);
    expect(validateWithdrawalConfirmationCode('ABC123', null)).toBe(false);
  });
});
