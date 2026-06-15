import {
  assertConfigHostnameResolvesToPublicIps,
  fetchRuntimeConfigFromEnv,
  parseAllowedHosts,
} from './runtime-config-proxy';

jest.mock('node:dns', () => ({
  promises: {
    lookup: jest.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const dns = require('node:dns') as { promises: { lookup: jest.Mock } };

describe('parseAllowedHosts', () => {
  it('parses comma-separated hosts as lowercase', () => {
    expect(parseAllowedHosts(' Example.COM , foo ')).toEqual(['example.com', 'foo']);
  });

  it('returns empty for undefined or blank', () => {
    expect(parseAllowedHosts(undefined)).toEqual([]);
    expect(parseAllowedHosts('  ')).toEqual([]);
  });

  it('keeps "*" entry for explicit allow-all semantics', () => {
    expect(parseAllowedHosts('*, Example.COM')).toEqual(['*', 'example.com']);
  });
});

describe('assertConfigHostnameResolvesToPublicIps', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    dns.promises.lookup.mockResolvedValue([{ address: '203.0.113.10', family: 4 }]);
  });

  it('skips lookup for literal IP', async () => {
    await expect(
      assertConfigHostnameResolvesToPublicIps('203.0.113.1', { NODE_ENV: 'production' }),
    ).resolves.toBeNull();
    expect(dns.promises.lookup).not.toHaveBeenCalled();
  });

  it('skips lookup for dev self host', async () => {
    await expect(assertConfigHostnameResolvesToPublicIps('localhost', { NODE_ENV: 'development' })).resolves.toBeNull();
    expect(dns.promises.lookup).not.toHaveBeenCalled();
  });

  it('skips when NODE_ENV is test', async () => {
    await expect(assertConfigHostnameResolvesToPublicIps('evil.example', { NODE_ENV: 'test' })).resolves.toBeNull();
    expect(dns.promises.lookup).not.toHaveBeenCalled();
  });

  it('rejects when DNS returns private IPv4', async () => {
    dns.promises.lookup.mockResolvedValue([{ address: '10.0.0.1', family: 4 }]);

    await expect(
      assertConfigHostnameResolvesToPublicIps('config.example.com', { NODE_ENV: 'production' }),
    ).resolves.toEqual({
      kind: 'error',
      statusCode: 500,
      log: 'CONFIG hostname resolves to a private or loopback address',
    });
  });

  it('allows private DNS resolution when CONFIG_ALLOW_INTERNAL_HOST=true', async () => {
    dns.promises.lookup.mockResolvedValue([{ address: '10.0.0.1', family: 4 }]);

    await expect(
      assertConfigHostnameResolvesToPublicIps('config.example.com', {
        NODE_ENV: 'production',
        CONFIG_ALLOW_INTERNAL_HOST: 'true',
      }),
    ).resolves.toBeNull();
  });

  it('accepts when DNS returns public IP', async () => {
    dns.promises.lookup.mockResolvedValue([{ address: '198.51.100.2', family: 4 }]);

    await expect(
      assertConfigHostnameResolvesToPublicIps('config.example.com', { NODE_ENV: 'production' }),
    ).resolves.toBeNull();
  });
});

describe('fetchRuntimeConfigFromEnv', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.resetAllMocks();
    dns.promises.lookup.mockResolvedValue([{ address: '203.0.113.10', family: 4 }]);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns no_config when CONFIG is unset', async () => {
    await expect(fetchRuntimeConfigFromEnv({})).resolves.toEqual({ kind: 'no_config' });
  });

  it('rejects http in production without CONFIG_ALLOW_INSECURE_HTTP', async () => {
    await expect(
      fetchRuntimeConfigFromEnv({
        CONFIG: 'http://example.com/cfg.json',
        CONFIG_ALLOWED_HOSTS: 'example.com',
        NODE_ENV: 'production',
      }),
    ).resolves.toMatchObject({
      kind: 'error',
      statusCode: 500,
    });
  });

  it('allows http in production when CONFIG_ALLOW_INSECURE_HTTP=true', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => JSON.stringify({ production: false }),
    });

    await expect(
      fetchRuntimeConfigFromEnv({
        CONFIG: 'http://example.com/cfg.json',
        CONFIG_ALLOWED_HOSTS: 'example.com',
        NODE_ENV: 'production',
        CONFIG_ALLOW_INSECURE_HTTP: 'true',
      }),
    ).resolves.toEqual({
      kind: 'ok',
      value: { production: false },
    });
  });

  it('requires CONFIG_ALLOWED_HOSTS in production when CONFIG is set', async () => {
    await expect(
      fetchRuntimeConfigFromEnv({
        CONFIG: 'https://example.com/x.json',
        NODE_ENV: 'production',
      }),
    ).resolves.toMatchObject({ kind: 'error', log: expect.stringContaining('CONFIG_ALLOWED_HOSTS') });
  });

  it('allows any hostname when CONFIG_ALLOWED_HOSTS is "*" in production', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => JSON.stringify({ production: true }),
    });

    await expect(
      fetchRuntimeConfigFromEnv({
        CONFIG: 'https://evil.example/x.json',
        CONFIG_ALLOWED_HOSTS: '*',
        NODE_ENV: 'production',
      }),
    ).resolves.toEqual({
      kind: 'ok',
      value: { production: true },
    });
  });

  it('allows localhost in development without allowlist', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/json; charset=utf-8' }),
      text: async () => '{}',
    });

    await expect(
      fetchRuntimeConfigFromEnv({
        CONFIG: 'http://127.0.0.1:9999/config.json',
        NODE_ENV: 'development',
      }),
    ).resolves.toEqual({ kind: 'ok', value: {} });
  });

  it('allows any hostname in development when CONFIG_ALLOWED_HOSTS is empty (legacy behavior)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/json; charset=utf-8' }),
      text: async () => JSON.stringify({ legacy: true }),
    });

    await expect(
      fetchRuntimeConfigFromEnv({
        CONFIG: 'https://example.com/x.json',
        NODE_ENV: 'development',
      }),
    ).resolves.toEqual({
      kind: 'ok',
      value: { legacy: true },
    });
  });

  it('allows private IP targets when CONFIG_ALLOW_INTERNAL_HOST=true', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/json; charset=utf-8' }),
      text: async () => '{}',
    });

    await expect(
      fetchRuntimeConfigFromEnv({
        CONFIG: 'http://10.0.0.5:9999/config.json',
        NODE_ENV: 'development',
        CONFIG_ALLOW_INTERNAL_HOST: 'true',
      }),
    ).resolves.toEqual({ kind: 'ok', value: {} });
  });

  it('rejects non-object JSON', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => '[]',
    });

    await expect(
      fetchRuntimeConfigFromEnv({
        CONFIG: 'https://example.com/x.json',
        CONFIG_ALLOWED_HOSTS: 'example.com',
        NODE_ENV: 'production',
      }),
    ).resolves.toMatchObject({ kind: 'error', log: expect.stringContaining('plain object') });
  });

  it('rejects wrong content-type', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'text/plain' }),
      text: async () => '{}',
    });

    await expect(
      fetchRuntimeConfigFromEnv({
        CONFIG: 'https://example.com/x.json',
        CONFIG_ALLOWED_HOSTS: 'example.com',
        NODE_ENV: 'production',
      }),
    ).resolves.toMatchObject({ kind: 'error', log: expect.stringContaining('application/json') });
  });

  it('rejects CONFIG hostname when DNS resolves to private address', async () => {
    dns.promises.lookup.mockResolvedValue([{ address: '192.168.1.1', family: 4 }]);
    global.fetch = jest.fn();

    await expect(
      fetchRuntimeConfigFromEnv({
        CONFIG: 'https://example.com/x.json',
        CONFIG_ALLOWED_HOSTS: 'example.com',
        NODE_ENV: 'production',
      }),
    ).resolves.toMatchObject({
      kind: 'error',
      log: 'CONFIG hostname resolves to a private or loopback address',
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('does not fetch when DNS resolution fails', async () => {
    dns.promises.lookup.mockRejectedValue(new Error('ENOTFOUND'));
    global.fetch = jest.fn();

    await expect(
      fetchRuntimeConfigFromEnv({
        CONFIG: 'https://example.com/x.json',
        CONFIG_ALLOWED_HOSTS: 'example.com',
        NODE_ENV: 'production',
      }),
    ).resolves.toMatchObject({
      kind: 'error',
      log: expect.stringContaining('could not be resolved'),
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
