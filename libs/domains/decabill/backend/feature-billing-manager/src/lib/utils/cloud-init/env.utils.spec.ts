import { formatEnvLine, formatEnvLines, quoteComposeValue, quoteYamlScalar, shellSingleQuote } from './env.utils';

describe('env.utils', () => {
  describe('quoteYamlScalar', () => {
    it('quotes empty values', () => {
      expect(quoteYamlScalar('')).toBe("''");
    });

    it('leaves simple identifiers unquoted', () => {
      expect(quoteYamlScalar('production')).toBe('production');
      expect(quoteYamlScalar('redis')).toBe('redis');
      // Starts with a digit: quoted so YAML never reinterprets it (same string for compose).
      expect(quoteYamlScalar('0.0.0.0')).toBe("'0.0.0.0'");
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

  describe('injection safety', () => {
    it('keeps values with line breaks on one line as an escaped double-quoted scalar', () => {
      expect(quoteYamlScalar('a\nEOF\nINJECTED: 1')).toBe('"a\\nEOF\\nINJECTED: 1"');
      expect(formatEnvLine('KEY: -----BEGIN-----\nabc')).toBe('KEY: "-----BEGIN-----\\nabc"');
    });

    it('doubles $ in compose values so docker-compose does not interpolate them', () => {
      expect(quoteComposeValue('p$ss${HOME}')).toBe("'p$$ss$${HOME}'");
      expect(formatEnvLine('SECRET: a$b')).toBe("SECRET: 'a$$b'");
      expect(quoteComposeValue('plain')).toBe('plain');
    });
  });

  describe('YAML type safety', () => {
    it.each(['null', 'NULL', 'true', 'False', 'yes', 'on', 'n', '1.10', '0123', '1e5', '0x1F', '-0', '.5'])(
      'quotes %s so compose keeps it as the same string',
      (value) => {
        expect(quoteYamlScalar(value)).toBe(`'${value}'`);
      },
    );

    it.each(['api-client', 'oidc', 'abc.def', '0', '42', '-7'])('keeps %s plain', (value) => {
      expect(quoteYamlScalar(value)).toBe(value);
    });
  });

  describe('shellSingleQuote', () => {
    it('produces a literal that bash prints verbatim (no expansion / injection)', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      const { execFileSync } = require('node:child_process') as typeof import('node:child_process');
      const hostile = `ssh-ed25519 AAAAC3Nza x"; touch /tmp/should-not-exist-$$; echo "$(id) \`id\` 'q' \\`;
      const output = execFileSync('bash', ['-c', `printf '%s\\n' ${shellSingleQuote(hostile)}`]).toString();

      expect(output).toBe(`${hostile}\n`);
    });

    it('keeps the value on one line', () => {
      expect(shellSingleQuote('a\nb')).toBe("'a b'");
    });
  });
});
