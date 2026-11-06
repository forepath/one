import { BadRequestException } from '@nestjs/common';

import {
  assertClientEndpointHostnameResolvesToPublicIps,
  assertSafeClientEndpointOrThrow,
  createPinnedSocketAgent,
  createPublicAddressLookup,
  getClientEndpointTlsPolicy,
  resetClientEndpointTlsWarningForTests,
  validateClientEndpointWithDnsOrThrow,
} from './client-endpoint-security';

jest.mock('node:dns', () => ({
  lookup: jest.fn(),
  promises: {
    lookup: jest.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const dns = require('node:dns') as { lookup: jest.Mock; promises: { lookup: jest.Mock } };

describe('client-endpoint-security', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetAllMocks();
    process.env = { ...originalEnv };
    process.env.NODE_ENV = 'production';
    process.env.CLIENT_ENDPOINT_ALLOWED_HOSTS = 'example.com,api.partner.test';
    delete process.env.CLIENT_ENDPOINT_ALLOW_INSECURE_HTTP;
    delete process.env.CLIENT_ENDPOINT_ALLOW_INTERNAL_HOST;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('assertSafeClientEndpointOrThrow', () => {
    it('accepts https URL with allowlisted host', () => {
      const url = assertSafeClientEndpointOrThrow('https://example.com/base');

      expect(url.hostname).toBe('example.com');
    });

    it('rejects host not in allowlist', () => {
      expect(() => assertSafeClientEndpointOrThrow('https://evil.com/x')).toThrow(BadRequestException);
    });

    it('accepts host when allowlist is "*" (explicit allow-all)', () => {
      process.env.CLIENT_ENDPOINT_ALLOWED_HOSTS = '*';

      const url = assertSafeClientEndpointOrThrow('https://evil.com/x');

      expect(url.hostname).toBe('evil.com');
    });

    it('allows private IP when CLIENT_ENDPOINT_ALLOW_INTERNAL_HOST=true', () => {
      process.env.CLIENT_ENDPOINT_ALLOWED_HOSTS = '*';
      process.env.CLIENT_ENDPOINT_ALLOW_INTERNAL_HOST = 'true';

      const url = assertSafeClientEndpointOrThrow('https://10.0.0.1/');

      expect(url.hostname).toBe('10.0.0.1');
    });
  });

  describe('assertClientEndpointHostnameResolvesToPublicIps', () => {
    it('rejects when DNS returns private IPv4', async () => {
      process.env.NODE_ENV = 'production';
      dns.promises.lookup.mockResolvedValue([{ address: '10.0.0.1', family: 4 }]);

      await expect(assertClientEndpointHostnameResolvesToPublicIps('example.com')).rejects.toThrow(BadRequestException);
    });

    it('accepts when DNS returns public IP', async () => {
      process.env.NODE_ENV = 'production';
      dns.promises.lookup.mockResolvedValue([{ address: '203.0.113.1', family: 4 }]);

      await expect(assertClientEndpointHostnameResolvesToPublicIps('example.com')).resolves.toBeUndefined();
    });

    it('skips DNS check when CLIENT_ENDPOINT_ALLOW_INTERNAL_HOST=true', async () => {
      process.env.NODE_ENV = 'production';
      process.env.CLIENT_ENDPOINT_ALLOW_INTERNAL_HOST = 'true';

      await expect(assertClientEndpointHostnameResolvesToPublicIps('example.com')).resolves.toBeUndefined();

      expect(dns.promises.lookup).not.toHaveBeenCalled();
    });
  });

  describe('validateClientEndpointWithDnsOrThrow', () => {
    it('runs sync validation then DNS', async () => {
      process.env.NODE_ENV = 'production';
      dns.promises.lookup.mockResolvedValue([{ address: '198.51.100.2', family: 4 }]);

      const url = await validateClientEndpointWithDnsOrThrow('https://api.partner.test/');

      expect(url.hostname).toBe('api.partner.test');
      expect(dns.promises.lookup).toHaveBeenCalled();
    });
  });

  describe('getClientEndpointTlsPolicy', () => {
    beforeEach(() => {
      process.env = { ...originalEnv };
      resetClientEndpointTlsWarningForTests();
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('verifies TLS by default without logging', () => {
      const logger = { warn: jest.fn() };

      delete process.env['CLIENT_ENDPOINT_TLS_REJECT_UNAUTHORIZED'];

      expect(getClientEndpointTlsPolicy(logger as never)).toEqual({ rejectUnauthorized: true });
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('warns only once per process when TLS verification is disabled', () => {
      const first = { warn: jest.fn() };
      const second = { warn: jest.fn() };

      process.env['CLIENT_ENDPOINT_TLS_REJECT_UNAUTHORIZED'] = 'false';
      process.env['NODE_ENV'] = 'development';

      for (let i = 0; i < 5; i++) {
        expect(getClientEndpointTlsPolicy(first as never)).toEqual({ rejectUnauthorized: false });
      }

      getClientEndpointTlsPolicy(second as never);

      expect(first.warn).toHaveBeenCalledTimes(1);
      expect(second.warn).not.toHaveBeenCalled();
    });

    it('still refuses disabled TLS verification in production', () => {
      process.env['CLIENT_ENDPOINT_TLS_REJECT_UNAUTHORIZED'] = 'false';
      process.env['NODE_ENV'] = 'production';

      expect(() => getClientEndpointTlsPolicy()).toThrow('not allowed in production');
    });
  });

  describe('createPublicAddressLookup (connection-time DNS pinning)', () => {
    const resolveWith = (addresses: Array<{ address: string; family: number }>) =>
      dns.lookup.mockImplementation((_host: string, _options: unknown, callback: (...args: unknown[]) => void) =>
        callback(null, addresses),
      );
    const run = (all: boolean) =>
      new Promise<{ error?: Error; result?: unknown }>((resolve) =>
        (createPublicAddressLookup() as unknown as (h: string, o: object, cb: (...args: unknown[]) => void) => void)(
          'idp.example.org',
          { all },
          (error: Error | null, address?: unknown, family?: unknown) =>
            resolve(error ? { error } : { result: all ? address : { address, family } }),
        ),
      );

    beforeEach(() => {
      process.env.NODE_ENV = 'production';
      delete process.env.CLIENT_ENDPOINT_ALLOW_INTERNAL_HOST;
    });

    it('passes public addresses through (single and all)', async () => {
      resolveWith([{ address: '93.184.216.34', family: 4 }]);

      await expect(run(false)).resolves.toEqual({ result: { address: '93.184.216.34', family: 4 } });
      await expect(run(true)).resolves.toEqual({ result: [{ address: '93.184.216.34', family: 4 }] });
    });

    it.each(['127.0.0.1', '10.0.0.5', '169.254.169.254', '::1', '192.168.1.2'])(
      'rejects %s at connection time (DNS rebinding)',
      async (address) => {
        resolveWith([
          { address: '93.184.216.34', family: 4 },
          { address, family: address.includes(':') ? 6 : 4 },
        ]);

        const { error } = await run(false);

        expect(error?.message).toMatch(/private or loopback/);
      },
    );

    it('honours CLIENT_ENDPOINT_ALLOW_INTERNAL_HOST', async () => {
      process.env.CLIENT_ENDPOINT_ALLOW_INTERNAL_HOST = 'true';
      resolveWith([{ address: '10.0.0.5', family: 4 }]);

      await expect(run(false)).resolves.toEqual({ result: { address: '10.0.0.5', family: 4 } });
    });

    it('propagates resolution errors', async () => {
      dns.lookup.mockImplementation((_h: string, _o: unknown, callback: (...args: unknown[]) => void) =>
        callback(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' })),
      );

      await expect(run(false)).resolves.toEqual({ error: expect.objectContaining({ code: 'ENOTFOUND' }) });
    });
  });

  describe('createPinnedSocketAgent', () => {
    it('creates a non-pooling agent (https for wss/https) whose lookup rejects private addresses', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.CLIENT_ENDPOINT_ALLOW_INTERNAL_HOST;

      const secure = createPinnedSocketAgent('https://manager.example.org/socket/agents', true) as unknown as {
        protocol: string;
        options: { keepAlive: boolean; lookup: (...args: unknown[]) => void; rejectUnauthorized?: boolean };
      };
      const plain = createPinnedSocketAgent('http://manager.example.org/socket/agents', true) as unknown as {
        protocol: string;
      };

      expect(secure.protocol).toBe('https:');
      expect(plain.protocol).toBe('http:');
      expect(secure.options).toEqual(expect.objectContaining({ keepAlive: false, rejectUnauthorized: true }));

      dns.lookup.mockImplementation((_h: string, _o: unknown, callback: (...args: unknown[]) => void) =>
        callback(null, [{ address: '10.0.0.5', family: 4 }]),
      );

      const error = await new Promise<Error | null>((resolve) =>
        secure.options.lookup('manager.example.org', {}, (err: Error | null) => resolve(err)),
      );

      expect(error?.message).toMatch(/private or loopback/);
    });
  });
});
