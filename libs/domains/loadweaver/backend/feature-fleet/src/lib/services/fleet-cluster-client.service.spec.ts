import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  clusterConnectionFailure,
  FleetClusterClient,
  isTemporaryClusterFailure,
  jwtExpiresAt,
} from './fleet-cluster-client.service';

const err = (code: string | undefined, message = 'x') => Object.assign(new Error(message), code ? { code } : {});

describe('clusterConnectionFailure (3.43 live test: a relay during the cluster restart answered 500)', () => {
  it.each([
    [err('ECONNRESET', 'socket hang up'), 'hang-up'],
    [err(undefined, 'socket hang up'), 'hang-up'],
    [err('ECONNREFUSED', 'connect ECONNREFUSED 10.0.0.1:443'), 'refused'],
    [err('ECONNRESET', 'read ECONNRESET'), 'reset'],
    [err('EPIPE'), 'reset'],
    [err('ECONNABORTED', 'timeout of 30000ms exceeded'), 'timeout'],
    [err('ETIMEDOUT'), 'timeout'],
    [err(undefined, 'timeout of 1000ms exceeded'), 'timeout'],
    [err('EHOSTUNREACH'), 'network'],
    [err('ENOTFOUND'), 'network'],
    [err('CERT_HAS_EXPIRED'), 'tls'],
    [err('UNABLE_TO_VERIFY_LEAF_SIGNATURE'), 'tls'],
    [err('ERR_TLS_CERT_ALTNAME_INVALID'), 'tls'],
    [err('ERR_CANCELED', 'canceled'), 'aborted'],
    [err(undefined, 'address 10.0.0.1 is not allowed'), 'other'],
    ['plain string', 'other'],
    [null, 'other'],
  ])('%#: %s', (error, expected) => {
    expect(clusterConnectionFailure(error)).toBe(expected);
  });

  it('treats refused / reset / hang-up / timeout as temporary', () => {
    expect(['refused', 'reset', 'hang-up', 'timeout'].every((f) => isTemporaryClusterFailure(f as never))).toBe(true);
    expect(['network', 'tls', 'aborted', 'other', null].some((f) => isTemporaryClusterFailure(f as never))).toBe(false);
  });
});

describe('FleetClusterClient: PAT credentials are exchanged for their machine token (combined gate 2026-10-31)', () => {
  const jwt = (exp: number, n = 1) =>
    `h.${Buffer.from(JSON.stringify({ sub: 'svc', exp, n })).toString('base64url')}.s`;
  let server: Server;
  let base: string;
  let exchanges: unknown[];
  let seen: string[];
  let exchangeStatus: number;
  let refuse: Set<string>;
  let issued: number;
  const env = { ...process.env };

  beforeEach(async () => {
    exchanges = [];
    seen = [];
    exchangeStatus = 200;
    refuse = new Set();
    issued = 0;
    process.env['FLEET_CLUSTER_ENDPOINT_ALLOW_INSECURE_HTTP'] = 'true';
    process.env['FLEET_CLUSTER_ENDPOINT_ALLOW_INTERNAL_HOST'] = 'true';
    server = createServer((req, res) => {
      let body = '';

      req.on('data', (c) => (body += c));
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');

        if (req.url === '/api/auth/token' && req.method === 'POST') {
          exchanges.push(JSON.parse(body));
          res.statusCode = exchangeStatus;
          res.end(
            JSON.stringify(
              exchangeStatus === 200 ? { access_token: jwt(Math.floor(Date.now() / 1000) + 900, ++issued) } : {},
            ),
          );

          return;
        }

        const auth = String(req.headers.authorization ?? '');

        seen.push(auth);
        res.statusCode = refuse.has(auth) ? 401 : 200;
        res.end(JSON.stringify({ ok: true }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    process.env = { ...env };
    await new Promise((resolve) => server.close(resolve));
  });

  const cluster = (credential: string) => ({
    id: 'c1',
    endpoint: base,
    caCertificate: null,
    credential,
    updatedAt: new Date(0),
  });

  it('exchanges a PAT once and sends the machine token, cached until shortly before it expires', async () => {
    const client = new FleetClusterClient();
    const c = cluster('fp_pat_service-secret');

    await Promise.all([
      client.json(c, { method: 'GET', path: 'cluster' }),
      client.json(c, { method: 'GET', path: 'cluster' }),
    ]);
    await client.json(c, { method: 'GET', path: 'overview' });

    expect(exchanges).toEqual([{ token: 'fp_pat_service-secret' }]);
    expect(new Set(seen)).toEqual(new Set([`Bearer ${await client.bearer(c)}`]));
    expect(seen.join(' ')).not.toContain('fp_pat_');
  });

  it('uses API keys and JWTs as they are', async () => {
    const client = new FleetClusterClient();

    await client.json(cluster('static-api-key'), { method: 'GET', path: 'cluster' });

    expect(exchanges).toEqual([]);
    expect(seen).toEqual(['Bearer static-api-key']);
  });

  it('falls back to the credential when the exchange is refused (the cluster then rejects it)', async () => {
    const client = new FleetClusterClient();

    exchangeStatus = 401;

    expect(await client.bearer(cluster('fp_pat_revoked'))).toBe('fp_pat_revoked');
  });

  it('exchanges anew after the cluster refused the token, and when the credential changes', async () => {
    const client = new FleetClusterClient();
    const c = cluster('fp_pat_service-secret');
    const first = await client.bearer(c);

    refuse.add(`Bearer ${first}`);
    await expect(client.json(c, { method: 'GET', path: 'cluster' })).rejects.toThrow('HTTP 401');

    const second = await client.bearer(c);

    expect(second).not.toBe(first);
    expect(await client.bearer(cluster('fp_pat_rotated'))).not.toBe(second);
    expect(exchanges).toHaveLength(3);
  });

  it('reads the expiry of a JWT', () => {
    expect(jwtExpiresAt(jwt(1_800_000_000))).toBe(1_800_000_000_000);
    expect(jwtExpiresAt('not-a-jwt')).toBeNull();
  });
});
