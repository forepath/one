import { readExtensionsFromEnv } from './read-extensions-from-env';

describe('readExtensionsFromEnv', () => {
  const envKey = 'TEST_EXTENSIONS_ENV';

  afterEach(() => {
    delete process.env[envKey];
  });

  it('returns defaults when env var is unset', () => {
    expect(readExtensionsFromEnv(envKey, ['@forepath/demo/provider-a'])).toEqual(['@forepath/demo/provider-a']);
  });

  it('parses comma-separated specifiers', () => {
    process.env[envKey] = '@forepath/a/provider-a, npm:pkg-b , file:./ext';

    expect(readExtensionsFromEnv(envKey, [])).toEqual(['@forepath/a/provider-a', 'npm:pkg-b', 'file:./ext']);
  });
});
