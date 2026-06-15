import { formatEnvLines } from './env.utils';

describe('env.utils', () => {
  describe('formatEnvLines', () => {
    it('returns empty string when given empty array', () => {
      expect(formatEnvLines([])).toBe('');
    });

    it('prefixes each line with 6 spaces and joins with newline', () => {
      const lines = ['FOO=bar', 'BAZ=qux'];

      expect(formatEnvLines(lines)).toBe('      FOO=bar\n      BAZ=qux');
    });

    it('trims leading and trailing whitespace from each line', () => {
      const lines = ['  FOO=bar  ', '  BAZ=qux'];

      expect(formatEnvLines(lines)).toBe('      FOO=bar\n      BAZ=qux');
    });

    it('skips empty lines after trim', () => {
      const lines = ['FOO=bar', '', '   ', 'BAZ=qux'];

      expect(formatEnvLines(lines)).toBe('      FOO=bar\n      BAZ=qux');
    });

    it('handles single line', () => {
      expect(formatEnvLines(['NODE_ENV=production'])).toBe('      NODE_ENV=production');
    });
  });
});
