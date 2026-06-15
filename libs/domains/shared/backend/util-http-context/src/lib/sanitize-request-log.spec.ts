import { redactSecretsInString, sanitizeRequestUrlForLog } from './sanitize-request-log';

describe('sanitize-request-log', () => {
  describe('sanitizeRequestUrlForLog', () => {
    it('strips query string so secrets in query are not logged', () => {
      expect(sanitizeRequestUrlForLog('/api/foo?token=abc&refresh=xyz')).toBe('/api/foo');
    });

    it('returns empty string for undefined', () => {
      expect(sanitizeRequestUrlForLog(undefined)).toBe('');
    });

    it('decodes path segments', () => {
      expect(sanitizeRequestUrlForLog('/api/%20x')).toBe('/api/ x');
    });

    it('truncates very long paths', () => {
      const long = '/p/' + 'a'.repeat(300);

      expect(sanitizeRequestUrlForLog(long).length).toBeLessThanOrEqual(257);
      expect(sanitizeRequestUrlForLog(long).endsWith('…')).toBe(true);
    });

    it('falls back to raw path when decodeURIComponent throws', () => {
      const bad = '/api/%E0%A4%A';

      expect(sanitizeRequestUrlForLog(`${bad}?q=1`)).toBe(bad);
    });
  });

  describe('redactSecretsInString', () => {
    it('redacts Bearer tokens', () => {
      expect(redactSecretsInString('Authorization: Bearer eyJhbGciOiJIUzI1')).toContain('Bearer [REDACTED]');
      expect(redactSecretsInString('Authorization: Bearer eyJhbGciOiJIUzI1')).not.toContain('eyJ');
    });

    it('redacts Basic auth', () => {
      expect(redactSecretsInString('hdr Basic dXNlcjpwYXNz')).toBe('hdr Basic [REDACTED]');
    });

    it('redacts ApiKey style fragments', () => {
      expect(redactSecretsInString('ApiKey sk_live_abc')).toBe('ApiKey [REDACTED]');
    });

    it('redacts email addresses', () => {
      expect(redactSecretsInString('user user@example.com done')).toBe('user [EMAIL_REDACTED] done');
    });
  });
});
