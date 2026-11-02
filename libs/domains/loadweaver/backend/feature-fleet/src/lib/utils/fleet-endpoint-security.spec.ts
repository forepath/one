import type { LookupAddress } from 'node:dns';

import {
  clusterTlsRejectUnauthorized,
  createGuardedLookup,
  resolvedAddressesAllowed,
  normalizeCaCertificate,
  normalizeClusterEndpoint,
} from './fleet-endpoint-security';

const CERT = '-----BEGIN CERTIFICATE-----\nMIIBszCCAVmgAwIBAgIUQ==\n-----END CERTIFICATE-----';

describe('cluster endpoint guardrails (3.24)', () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
  });

  it('normalises https endpoints and drops a trailing /api', () => {
    expect(normalizeClusterEndpoint('https://LW.example.com/api/')).toEqual({
      endpoint: 'https://lw.example.com',
      hostname: 'lw.example.com',
    });
    expect(normalizeClusterEndpoint('https://x.example.com:8443/lw').endpoint).toBe('https://x.example.com:8443/lw');
  });

  it('refuses http, credentials, queries and invalid URLs', () => {
    expect(() => normalizeClusterEndpoint('http://lw.example.com')).toThrow('https');
    expect(() => normalizeClusterEndpoint('https://u:p@lw.example.com')).toThrow('credentials');
    expect(() => normalizeClusterEndpoint('https://lw.example.com/?a=1')).toThrow('query');
    expect(() => normalizeClusterEndpoint('not a url')).toThrow('valid URL');
  });

  it('allows http only outside production when enabled', () => {
    process.env['FLEET_CLUSTER_ENDPOINT_ALLOW_INSECURE_HTTP'] = 'true';
    process.env['FLEET_CLUSTER_ENDPOINT_ALLOW_INTERNAL_HOST'] = 'true';
    expect(normalizeClusterEndpoint('http://localhost:3400').endpoint).toBe('http://localhost:3400');
    process.env['NODE_ENV'] = 'production';
    expect(() => normalizeClusterEndpoint('http://localhost:3400')).toThrow('https');
  });

  it('refuses private and loopback targets unless internal hosts are allowed', () => {
    for (const url of [
      'https://127.0.0.1',
      'https://10.0.0.5',
      'https://[::1]',
      'https://localhost',
      'https://169.254.169.254',
    ])
      expect(() => normalizeClusterEndpoint(url)).toThrow('private or loopback');
    process.env['FLEET_CLUSTER_ENDPOINT_ALLOW_INTERNAL_HOST'] = 'true';
    expect(normalizeClusterEndpoint('https://10.0.0.5').hostname).toBe('10.0.0.5');
  });

  it('enforces the host allowlist', () => {
    process.env['FLEET_CLUSTER_ENDPOINT_ALLOWED_HOSTS'] = 'a.example.com, b.example.com';
    expect(normalizeClusterEndpoint('https://b.example.com').hostname).toBe('b.example.com');
    expect(() => normalizeClusterEndpoint('https://c.example.com')).toThrow('allowlist');
    process.env['FLEET_CLUSTER_ENDPOINT_ALLOWED_HOSTS'] = '*';
    expect(normalizeClusterEndpoint('https://c.example.com').hostname).toBe('c.example.com');
  });

  it('accepts PEM certificates only as CA', () => {
    expect(normalizeCaCertificate('')).toBeNull();
    expect(normalizeCaCertificate(`${CERT}\n${CERT}\n`)).toBe(`${CERT}\n${CERT}`);
    expect(() => normalizeCaCertificate('-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----')).toThrow('PEM');
  });

  it('keeps TLS verification on in production', () => {
    process.env['FLEET_CLUSTER_TLS_REJECT_UNAUTHORIZED'] = 'false';
    process.env['NODE_ENV'] = 'development';
    expect(clusterTlsRejectUnauthorized()).toBe(false);
    process.env['NODE_ENV'] = 'production';
    expect(() => clusterTlsRejectUnauthorized()).toThrow('not allowed in production');
  });

  describe('DNS rebinding: addresses are validated inside the agent lookup', () => {
    const resolver = (answers: LookupAddress[]) =>
      ((_host: string, _opts: unknown, cb: (e: Error | null, a: LookupAddress[]) => void) =>
        cb(null, answers)) as never;
    const run = (lookup: ReturnType<typeof createGuardedLookup>, all: boolean) =>
      new Promise<{ error: NodeJS.ErrnoException | null; address: unknown; family?: number }>((resolve) =>
        lookup('lw.example.com', { all }, (error, address, family) => resolve({ error, address, family })),
      );

    it('passes public answers through (single and all)', async () => {
      const lookup = createGuardedLookup(resolver([{ address: '203.0.113.10', family: 4 }]), () => false);

      await expect(run(lookup, false)).resolves.toEqual({ error: null, address: '203.0.113.10', family: 4 });
      await expect(run(lookup, true)).resolves.toMatchObject({
        error: null,
        address: [{ address: '203.0.113.10', family: 4 }],
      });
    });

    it('refuses a private / loopback answer at connect time (rebinding after registration)', async () => {
      for (const address of ['10.0.0.5', '127.0.0.1', '169.254.169.254', '::1']) {
        const lookup = createGuardedLookup(
          resolver([
            { address: '203.0.113.10', family: 4 },
            { address, family: address.includes(':') ? 6 : 4 },
          ]),
          () => false,
        );
        const result = await run(lookup, false);

        expect(result.error?.code).toBe('EFLEETPRIVATEADDRESS');
      }
    });

    it('allows internal answers only when internal hosts are allowed', async () => {
      const lookup = createGuardedLookup(resolver([{ address: '10.0.0.5', family: 4 }]), () => true);

      await expect(run(lookup, false)).resolves.toMatchObject({ error: null, address: '10.0.0.5' });
      expect(resolvedAddressesAllowed('lw.example.com', [], false)).toBe(false);
    });

    it('passes resolver errors on', async () => {
      const failing = ((_h: string, _o: unknown, cb: (e: Error) => void) =>
        cb(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }))) as never;
      const result = await run(
        createGuardedLookup(failing, () => false),
        false,
      );

      expect(result.error?.code).toBe('ENOTFOUND');
    });
  });
});
