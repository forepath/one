import { createTotpSecret, generateTotpCode, verifyTotpCode, buildTotpOtpauthUrl } from './totp.utils';

describe('totp.utils', () => {
  it('generates a verifiable TOTP code for a secret', async () => {
    const secret = createTotpSecret();
    const code = generateTotpCode(secret);

    expect(code).toMatch(/^[0-9]{6}$/);
    await expect(verifyTotpCode(code, secret)).resolves.toBe(true);
  });

  it('rejects invalid codes', async () => {
    const secret = createTotpSecret();

    await expect(verifyTotpCode('000000', secret)).resolves.toBe(false);
    await expect(verifyTotpCode('abcdef', secret)).resolves.toBe(false);
  });

  it('builds an otpauth URL', () => {
    const url = buildTotpOtpauthUrl('ABCDEFGHIJKLMNOP', 'user@example.com', 'Forepath');

    expect(url).toContain('otpauth://totp/');
    expect(url).toContain('secret=ABCDEFGHIJKLMNOP');
    expect(url).toContain('issuer=Forepath');
  });
});
