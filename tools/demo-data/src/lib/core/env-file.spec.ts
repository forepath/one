import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { loadEnvFile, parseEnvFile, readBooleanEnv, readListEnv } from './env-file';

describe('parseEnvFile', () => {
  it('should parse plain, quoted, exported and commented entries', () => {
    const values = parseEnvFile(
      [
        '# comment',
        'PLAIN=value',
        'EMPTY=',
        'export EXPORTED=yes',
        'DOUBLE="with spaces"',
        "SINGLE='keep # hash'",
        'INLINE=value # trailing comment',
        'KEY_WITH_EQUALS=a=b',
        'not-an-entry',
      ].join('\n'),
    );

    expect(values).toEqual({
      PLAIN: 'value',
      EMPTY: '',
      EXPORTED: 'yes',
      DOUBLE: 'with spaces',
      SINGLE: 'keep # hash',
      INLINE: 'value',
      KEY_WITH_EQUALS: 'a=b',
    });
  });
});

describe('loadEnvFile', () => {
  it('should return defaults when the file does not exist', () => {
    expect(loadEnvFile('/does/not/exist.env', { A: '1' })).toEqual({ A: '1' });
  });

  it('should keep defaults for empty values like compose does', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-data-env-'));
    const file = path.join(dir, '.start-containers.env');

    fs.writeFileSync(file, 'DB_DATABASE=\nTENANTS=a,b\n');

    expect(loadEnvFile(file, { DB_DATABASE: 'postgres' })).toEqual({ DB_DATABASE: 'postgres', TENANTS: 'a,b' });
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('env helpers', () => {
  it('should read booleans with a fallback', () => {
    expect(readBooleanEnv({ A: 'true', B: 'false' }, 'A', false)).toBe(true);
    expect(readBooleanEnv({ A: 'true', B: 'false' }, 'B', true)).toBe(false);
    expect(readBooleanEnv({}, 'C', true)).toBe(true);
  });

  it('should split comma separated lists', () => {
    expect(readListEnv({ TENANTS: ' a, b ,,c ' }, 'TENANTS')).toEqual(['a', 'b', 'c']);
    expect(readListEnv({}, 'TENANTS')).toEqual([]);
  });
});
