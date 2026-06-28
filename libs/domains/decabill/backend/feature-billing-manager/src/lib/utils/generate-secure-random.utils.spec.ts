import {
  DEFAULT_RANDOM_DEFAULT_LENGTH,
  generateSecureRandomString,
  MIN_RANDOM_DEFAULT_LENGTH,
  normalizeRandomDefaultLength,
} from './generate-secure-random.utils';

describe('generateSecureRandomString', () => {
  it('rejects lengths below minimum', () => {
    expect(() => generateSecureRandomString(20, false)).toThrow();
  });

  it('generates strings with required character classes', () => {
    const value = generateSecureRandomString(24, true);

    expect(value).toHaveLength(24);
    expect(/[a-z]/.test(value)).toBe(true);
    expect(/[A-Z]/.test(value)).toBe(true);
    expect(/[0-9]/.test(value)).toBe(true);
    expect(/[!@#$%^&*()\-_=+[\]{}|;:,.<>?]/.test(value)).toBe(true);
  });

  it('omits special characters when disabled', () => {
    const value = generateSecureRandomString(21, false);

    expect(value).toHaveLength(21);
    expect(/[^a-zA-Z0-9]/.test(value)).toBe(false);
  });
});

describe('normalizeRandomDefaultLength', () => {
  it('defaults to minimum length constant', () => {
    expect(normalizeRandomDefaultLength(undefined)).toBe(DEFAULT_RANDOM_DEFAULT_LENGTH);
    expect(normalizeRandomDefaultLength(10)).toBe(MIN_RANDOM_DEFAULT_LENGTH);
  });
});
