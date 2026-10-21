import { BadRequestException } from '@nestjs/common';

import {
  assertClientEndpointHostnameResolvesToPublicIps,
  assertSafeClientEndpointOrThrow,
  getClientEndpointTlsPolicy,
  resetClientEndpointTlsWarningForTests,
  validateClientEndpointWithDnsOrThrow,
} from './client-endpoint-security';

jest.mock('node:dns', () => ({
  promises: {
    lookup: jest.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const dns = require('node:dns') as { promises: { lookup: jest.Mock } };

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
});
