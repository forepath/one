import { formatEnvLine, formatEnvLines, quoteYamlScalar } from './env.utils';

describe('env.utils', () => {
  describe('quoteYamlScalar', () => {
    it('quotes empty values', () => {
      expect(quoteYamlScalar('')).toBe("''");
    });

    it('leaves simple identifiers unquoted', () => {
      expect(quoteYamlScalar('production')).toBe('production');
      expect(quoteYamlScalar('redis')).toBe('redis');
      expect(quoteYamlScalar('0.0.0.0')).toBe('0.0.0.0');
    });

    it('leaves integers unquoted', () => {
      expect(quoteYamlScalar('3100')).toBe('3100');
    });

    it('quotes YAML-significant scalars', () => {
      expect(quoteYamlScalar('*')).toBe("'*'");
      expect(quoteYamlScalar('https://example.com')).toBe("'https://example.com'");
      expect(quoteYamlScalar('/admin/queues')).toBe("'/admin/queues'");
      expect(quoteYamlScalar('noreply@localhost')).toBe("'noreply@localhost'");
    });

    it('escapes single quotes inside quoted values', () => {
      expect(quoteYamlScalar("it's fine")).toBe("'it''s fine'");
    });
  });

  describe('formatEnvLine', () => {
    it('quotes values that break YAML parsing', () => {
      expect(formatEnvLine('CLIENT_ENDPOINT_ALLOWED_HOSTS: *')).toBe("CLIENT_ENDPOINT_ALLOWED_HOSTS: '*'");
      expect(formatEnvLine('CORS_ORIGIN: https://test.spirde.com')).toBe("CORS_ORIGIN: 'https://test.spirde.com'");
    });

    it('quotes empty values after colon', () => {
      expect(formatEnvLine('REDIS_PASSWORD: ')).toBe("REDIS_PASSWORD: ''");
      expect(formatEnvLine('REDIS_PASSWORD:')).toBe("REDIS_PASSWORD: ''");
    });

    it('supports KEY=value format', () => {
      expect(formatEnvLine('FOO=bar')).toBe('FOO: bar');
      expect(formatEnvLine('URL=https://x.com')).toBe("URL: 'https://x.com'");
    });
  });

  describe('formatEnvLines', () => {
    it('returns empty string when given empty array', () => {
      expect(formatEnvLines([])).toBe('');
    });

    it('prefixes each line with 6 spaces and joins with newline', () => {
      const lines = ['FOO=bar', 'BAZ=qux'];

      expect(formatEnvLines(lines)).toBe('      FOO: bar\n      BAZ: qux');
    });

    it('trims leading and trailing whitespace from each line', () => {
      const lines = ['  FOO=bar  ', '  BAZ=qux'];

      expect(formatEnvLines(lines)).toBe('      FOO: bar\n      BAZ: qux');
    });

    it('skips empty lines after trim', () => {
      const lines = ['FOO=bar', '', '   ', 'BAZ=qux'];

      expect(formatEnvLines(lines)).toBe('      FOO: bar\n      BAZ: qux');
    });

    it('handles single line', () => {
      expect(formatEnvLines(['NODE_ENV=production'])).toBe('      NODE_ENV: production');
    });
  });
});
