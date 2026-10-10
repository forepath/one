import {
  assertValidEnvironmentVariableName,
  buildSingleFileTar,
  extractFirstFileFromTar,
  parseDockerEnvList,
  parseEnvironmentFile,
  serializeEnvironmentFile,
  toDockerEnvList,
} from './agent-environment-file.utils';

function paxEntry(content: string): Buffer {
  const header = Buffer.alloc(512, 0);
  const body = Buffer.from(content, 'utf-8');

  header.write('PaxHeaders/environment', 0);
  header.write(`${body.length.toString(8).padStart(11, '0')}\0`, 124);
  header.write('x', 156);

  const padding = (512 - (body.length % 512)) % 512;

  return Buffer.concat([header, body, Buffer.alloc(padding, 0)]);
}

describe('agent-environment-file.utils', () => {
  describe('assertValidEnvironmentVariableName', () => {
    it.each(['FOO', 'foo_bar', 'my-var', 'A1', '_X', 'a.b'])('accepts %s', (name) => {
      expect(() => assertValidEnvironmentVariableName(name)).not.toThrow();
    });

    it.each(['', 'A=B', 'A\0B', '-i', '-S', 'BASH_FUNC_runuser%%', 'BASH_FUNC_x()', '1ABC', 'A B', 'A\nB'])(
      'rejects %p',
      (name) => {
        expect(() => assertValidEnvironmentVariableName(name)).toThrow('Invalid environment variable name');
      },
    );
  });

  describe('serializeEnvironmentFile / parseEnvironmentFile', () => {
    it('round-trips values with spaces, quotes, newlines, equals signs and shell metacharacters', () => {
      const env = {
        PLAIN: 'value',
        SPACES: 'hello world',
        QUOTES: `"double" 'single'`,
        MULTILINE: 'line1\nline2\r\n\tline3',
        EQUALS: 'a=b=c',
        SHELL: '$(touch /tmp/pwned); `id`; ${HOME}',
        EMPTY: '',
        UNICODE: 'grüße ✓',
      };
      const parsed = parseEnvironmentFile(serializeEnvironmentFile(env));

      expect(parsed).toEqual(env);
    });

    it('serializes NUL-terminated entries in sorted key order', () => {
      expect(serializeEnvironmentFile({ B: '2', A: '1' }).toString('utf-8')).toBe('A=1\0B=2\0');
    });

    it('rejects NUL characters in values', () => {
      expect(() => serializeEnvironmentFile({ A: 'x\0y' })).toThrow('must not contain NUL');
    });

    it('rejects invalid keys', () => {
      expect(() => serializeEnvironmentFile({ '-i': 'x' })).toThrow('Invalid environment variable name');
    });

    it('ignores malformed entries when parsing', () => {
      expect(parseEnvironmentFile('=nokey\0NOVALUE\0-u=x\0OK=1\0\0')).toEqual({ OK: '1' });
    });

    it('returns an empty map for an empty file', () => {
      expect(parseEnvironmentFile(Buffer.alloc(0))).toEqual({});
    });
  });

  describe('docker env list helpers', () => {
    it('converts maps to Docker env strings and back', () => {
      const env = { A: '1', B: 'x=y', C: '' };

      expect(parseDockerEnvList(toDockerEnvList(env))).toEqual(env);
    });

    it('handles missing env lists', () => {
      expect(parseDockerEnvList(undefined)).toEqual({});
      expect(parseDockerEnvList(null)).toEqual({});
    });
  });

  describe('tar helpers', () => {
    it('builds a valid ustar archive that round-trips', () => {
      const content = serializeEnvironmentFile({ A: '1', B: 'two words' });
      const archive = buildSingleFileTar('environment', content);

      expect(archive.length % 512).toBe(0);
      expect(archive.subarray(0, 11).toString('ascii')).toBe('environment');
      expect(archive.subarray(257, 262).toString('ascii')).toBe('ustar');
      expect(archive.subarray(100, 107).toString('ascii')).toBe('0000600');
      expect(extractFirstFileFromTar(archive)).toEqual(content);
    });

    it('writes a correct header checksum', () => {
      const archive = buildSingleFileTar('environment', Buffer.from('A=1\0'));
      const header = Buffer.from(archive.subarray(0, 512));
      const stored = parseInt(header.subarray(148, 154).toString('ascii'), 8);

      header.fill(' ', 148, 156);

      expect(stored).toBe(header.reduce((sum, byte) => sum + byte, 0));
    });

    it('handles empty files and block-aligned content', () => {
      expect(extractFirstFileFromTar(buildSingleFileTar('environment', Buffer.alloc(0)))).toEqual(Buffer.alloc(0));
      const aligned = Buffer.alloc(512, 0x41);

      expect(extractFirstFileFromTar(buildSingleFileTar('environment', aligned))).toEqual(aligned);
    });

    it('skips PAX meta entries', () => {
      const file = buildSingleFileTar('environment', Buffer.from('A=1\0'));
      const archive = Buffer.concat([paxEntry('30 mtime=1700000000.123456789\n'), file]);

      expect(extractFirstFileFromTar(archive).toString('utf-8')).toBe('A=1\0');
    });

    it('rejects invalid entry names', () => {
      expect(() => buildSingleFileTar('../environment', Buffer.alloc(0))).toThrow('Invalid tar entry name');
      expect(() => buildSingleFileTar('', Buffer.alloc(0))).toThrow('Invalid tar entry name');
    });

    it('rejects oversized, truncated and empty archives', () => {
      const archive = buildSingleFileTar('environment', Buffer.alloc(100, 0x41));

      expect(() => extractFirstFileFromTar(archive, 10)).toThrow('exceeds 10 bytes');
      expect(() => extractFirstFileFromTar(archive.subarray(0, 520))).toThrow('Truncated tar archive');
      expect(() => extractFirstFileFromTar(Buffer.alloc(1024, 0))).toThrow('does not contain a regular file');
    });

    it('rejects non-octal size fields', () => {
      const archive = buildSingleFileTar('environment', Buffer.from('A=1\0'));

      archive.write('zzzzzzzzzzz', 124, 'ascii');

      expect(() => extractFirstFileFromTar(archive)).toThrow('Unsupported tar header encoding');
    });
  });
});
