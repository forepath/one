import { BadRequestException, ForbiddenException } from '@nestjs/common';

import { FleetPersonEntity, TrustedFleetEntity } from './fleet-identity.entities';
import { mintTestClaim, testFleetKey } from './fleet-identity.testing';
import { FLEET_IDENTITY_HEADER, fleetBodyHash } from './fleet-identity.utils';
import {
  keyFingerprint,
  mergeTrustedFleetKeys,
  normalizeTrustedFleetKeys,
  TrustedFleetsService,
} from './trusted-fleets.service';

const NOW = new Date('2026-10-26T12:00:00.000Z');
const fleet = testFleetKey();

function setup(trusted: Partial<TrustedFleetEntity>[] = []) {
  const fleets: TrustedFleetEntity[] = trusted.map(
    (t) =>
      ({
        issuer: 'fleet-test',
        name: 'Fleet',
        keys: [{ kid: 'k1', publicKey: fleet.publicPem, addedAt: NOW.toISOString() }],
        createdBy: 'admin',
        createdAt: NOW,
        updatedAt: NOW,
        ...t,
      }) as TrustedFleetEntity,
  );
  const nonces = new Set<string>();
  const persons: Record<string, unknown>[] = [];
  const audit: unknown[] = [];
  const fleetRepo = {
    find: jest.fn(async () => fleets),
    findOne: jest.fn(
      async ({ where }: { where: { issuer: string } }) => fleets.find((f) => f.issuer === where.issuer) ?? null,
    ),
    create: jest.fn((x: Partial<TrustedFleetEntity>) => ({ createdAt: NOW, updatedAt: NOW, ...x })),
    save: jest.fn(async (x: TrustedFleetEntity) => {
      const i = fleets.findIndex((f) => f.issuer === x.issuer);

      if (i >= 0) fleets[i] = x;
      else fleets.push(x);

      return x;
    }),
    delete: jest.fn(async ({ issuer }: { issuer: string }) => {
      const i = fleets.findIndex((f) => f.issuer === issuer);

      if (i >= 0) fleets.splice(i, 1);
    }),
  };
  const personRepo = { upsert: jest.fn(async (row: Record<string, unknown>) => persons.push(row)) };
  const repo = (entity: unknown) =>
    entity === TrustedFleetEntity ? fleetRepo : entity === FleetPersonEntity ? personRepo : null;
  const dataSource = {
    getRepository: repo,
    query: jest.fn(async (sql: string, params: unknown[]) => {
      if (sql.startsWith('DELETE')) return [[], 0];

      const key = `${params[0]}/${params[1]}`;

      if (nonces.has(key)) return [];

      nonces.add(key);

      return [{ jti: params[1] }];
    }),
    transaction: jest.fn(async (fn: (m: unknown) => Promise<unknown>) => await fn({ getRepository: repo })),
  };
  const access = { assert: jest.fn(async () => ({ role: 'cluster-admin' })) };
  const auditLog = { record: jest.fn(async (_m: unknown, entry: unknown) => audit.push(entry)) };
  const identity = { cluster: jest.fn(async () => ({ clusterId: 'cluster-1' })) };
  const service = new TrustedFleetsService(dataSource as never, access as never, auditLog as never, identity as never);

  return { service, fleets, persons, audit, access, dataSource };
}

const fleetPatUser = { id: 'svc', amr: ['pat'], scopes: ['fleet:on-behalf-of'] };
const request = (token: string | undefined, overrides: Record<string, unknown> = {}) =>
  ({
    method: 'POST',
    originalUrl: '/api/plans/p1/approve',
    headers: token ? { [FLEET_IDENTITY_HEADER]: token } : {},
    user: fleetPatUser,
    ...overrides,
  }) as never;

describe('TrustedFleetsService: claim verification (3.24)', () => {
  it('verifies a trusted fleet’s claim, consumes its nonce once and records the person', async () => {
    const { service, persons } = setup([{}]);
    const token = mintTestClaim(fleet.privateKey, {}, NOW);

    await expect(service.evaluate(request(token), true, NOW)).resolves.toMatchObject({
      result: 'verified',
      identity: { person: 'fleet:fleet-test:u1' },
    });
    expect(persons).toEqual([
      expect.objectContaining({ personId: 'fleet:fleet-test:u1', email: 'alice@example.com', emailVerified: true }),
    ]);
    // The same claim again: a replay (the nonce table is shared by every replica).
    await expect(service.evaluate(request(token), true, NOW)).resolves.toEqual({
      result: 'refused',
      reason: 'claim replayed',
    });
  });

  it('verifies a socket subscription’s claim bound to SOCKET + the namespace, once (2026-10-27)', async () => {
    const { service } = setup([{}]);
    const token = mintTestClaim(
      fleet.privateKey,
      { htm: 'SOCKET', htu: '/socket/plans', role: null, prj: { shop: 'viewer' } },
      NOW,
    );

    await expect(service.evaluateSocket(token, 'topology', NOW)).resolves.toMatchObject({
      result: 'refused',
      reason: 'URL mismatch',
    });
    await expect(service.evaluateSocket(token, 'plans', NOW)).resolves.toMatchObject({
      result: 'verified',
      identity: { person: 'fleet:fleet-test:u1', projects: { shop: 'viewer' } },
    });
    await expect(service.evaluateSocket(token, 'plans', NOW)).resolves.toMatchObject({ result: 'refused' });
    await expect(service.evaluateSocket(undefined, 'plans', NOW)).resolves.toEqual({ result: 'none' });
  });

  it('binds the body: the raw JSON bytes the cluster received', async () => {
    const { service } = setup([{}]);
    const body = Buffer.from('{"confirm":true}');
    const token = mintTestClaim(fleet.privateKey, { body }, NOW);

    await expect(service.evaluate(request(token, { rawBody: body }), true, NOW)).resolves.toMatchObject({
      result: 'verified',
    });
    await expect(
      service.evaluate(
        request(mintTestClaim(fleet.privateKey, { body }, NOW), { rawBody: Buffer.from('{}') }),
        true,
        NOW,
      ),
    ).resolves.toEqual({ result: 'refused', reason: 'body mismatch' });
  });

  it('ignores claims of untrusted fleets and of callers that aren’t fleet service users', async () => {
    const { service } = setup([]);
    const token = mintTestClaim(fleet.privateKey, {}, NOW);

    await expect(service.evaluate(request(token), true, NOW)).resolves.toMatchObject({ result: 'ignored' });
    await expect(service.evaluate(request(undefined), true, NOW)).resolves.toEqual({ result: 'none' });

    const trusted = setup([{}]).service;

    await expect(
      trusted.evaluate(request(token, { user: { id: 'u', amr: ['pwd'] } }), true, NOW),
    ).resolves.toMatchObject({ result: 'ignored' });
    await expect(trusted.evaluate(request('garbage'), true, NOW)).resolves.toMatchObject({ result: 'ignored' });
  });

  it('refuses forged, foreign-key, expired or misbound claims of a trusted fleet', async () => {
    const { service } = setup([{}]);
    const old = new Date(NOW.getTime() - 300_000);

    for (const token of [
      mintTestClaim(testFleetKey().privateKey, {}, NOW),
      mintTestClaim(fleet.privateKey, { kid: 'k9' }, NOW),
      mintTestClaim(fleet.privateKey, {}, old),
      mintTestClaim(fleet.privateKey, { aud: 'other-cluster' }, NOW),
      mintTestClaim(fleet.privateKey, { htu: '/api/plans/p2/approve' }, NOW),
    ])
      await expect(service.evaluate(request(token), true, NOW)).resolves.toMatchObject({ result: 'refused' });
  });

  it('reports the probe’s result without using up a nonce', async () => {
    const { service, dataSource } = setup([{}]);
    const token = mintTestClaim(fleet.privateKey, { htm: 'GET', htu: '/api/fleet-identity', sub: '__probe' });

    await expect(
      service.status(request(token, { method: 'GET', originalUrl: '/api/fleet-identity' })),
    ).resolves.toMatchObject({ version: 1, clusterId: 'cluster-1', verified: true, issuer: 'fleet-test' });
    expect(dataSource.query).not.toHaveBeenCalled();
    await expect(service.status(request(undefined, { method: 'GET' }))).resolves.toMatchObject({
      verified: false,
      reason: 'no fleet identity claim',
    });
  });
});

describe('TrustedFleetsService: claims on the cluster API key (2026-10-29, API key fleet delegation)', () => {
  const apiKey = (token: string | undefined, overrides: Record<string, unknown> = {}) =>
    request(token, { user: undefined, apiKeyAuthenticated: true, ...overrides });

  afterEach(() => delete process.env['LOADWEAVER_API_KEY_FLEET_DELEGATION']);

  it('verifies a trusted fleet’s claim exactly like a PAT’s: person recorded, nonce used once', async () => {
    const { service, persons } = setup([{}]);
    const token = mintTestClaim(fleet.privateKey, { role: 'viewer', prj: { shop: 'operator' } }, NOW);

    await expect(service.evaluate(apiKey(token), true, NOW)).resolves.toMatchObject({
      result: 'verified',
      identity: { person: 'fleet:fleet-test:u1', role: 'viewer', projects: { shop: 'operator' } },
    });
    expect(persons).toEqual([expect.objectContaining({ personId: 'fleet:fleet-test:u1' })]);
    await expect(service.evaluate(apiKey(token), true, NOW)).resolves.toEqual({
      result: 'refused',
      reason: 'claim replayed',
    });
  });

  it('refuses tampered, foreign-key, expired or misbound claims of a trusted fleet', async () => {
    const { service } = setup([{}]);
    const [header, , signature] = mintTestClaim(fleet.privateKey, {}, NOW).split('.');
    const forgedPayload = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(mintTestClaim(fleet.privateKey, {}, NOW).split('.')[1], 'base64url').toString()),
        sub: 'mallory',
      }),
    ).toString('base64url');

    for (const token of [
      `${header}.${forgedPayload}.${signature}`,
      mintTestClaim(testFleetKey().privateKey, {}, NOW),
      mintTestClaim(fleet.privateKey, { kid: 'k9' }, NOW),
      mintTestClaim(fleet.privateKey, {}, new Date(NOW.getTime() - 300_000)),
      mintTestClaim(fleet.privateKey, { aud: 'other-cluster' }, NOW),
      mintTestClaim(fleet.privateKey, { htm: 'DELETE' }, NOW),
      mintTestClaim(fleet.privateKey, { htu: '/api/plans/p2/approve' }, NOW),
      mintTestClaim(fleet.privateKey, { bh: fleetBodyHash(Buffer.from('{}')) }, NOW),
    ])
      await expect(service.evaluate(apiKey(token), true, NOW)).resolves.toMatchObject({ result: 'refused' });
  });

  it('ignores an unknown issuer’s claim (the API key acts natively)', async () => {
    const { service, dataSource } = setup([]);

    await expect(service.evaluate(apiKey(mintTestClaim(fleet.privateKey, {}, NOW)), true, NOW)).resolves.toEqual({
      result: 'ignored',
      reason: 'fleet fleet-test is not trusted by this cluster',
    });
    expect(dataSource.query).not.toHaveBeenCalled();
  });

  it('switched off (LOADWEAVER_API_KEY_FLEET_DELEGATION=off): ignored as before; PATs unaffected', async () => {
    process.env['LOADWEAVER_API_KEY_FLEET_DELEGATION'] = 'off';

    const { service } = setup([{}]);

    await expect(service.evaluate(apiKey(mintTestClaim(fleet.privateKey, {}, NOW)), true, NOW)).resolves.toEqual({
      result: 'ignored',
      reason: 'API key fleet delegation is off on this cluster (LOADWEAVER_API_KEY_FLEET_DELEGATION)',
    });
    await expect(service.evaluate(request(mintTestClaim(fleet.privateKey, {}, NOW)), true, NOW)).resolves.toMatchObject(
      {
        result: 'verified',
      },
    );
  });

  it('still ignores PATs without fleet:on-behalf-of, naming both credentials that can carry identities', async () => {
    const { service } = setup([{}]);
    const pat = request(mintTestClaim(fleet.privateKey, {}, NOW), { user: { id: 'u', amr: ['pat'], scopes: [] } });

    await expect(service.evaluate(pat, true, NOW)).resolves.toEqual({
      result: 'ignored',
      reason: 'only PATs with fleet:on-behalf-of or the cluster API key send fleet identities',
    });
  });

  it('answers the identity probe over an API-key connection with verified', async () => {
    const { service } = setup([{}]);
    const token = mintTestClaim(fleet.privateKey, { htm: 'GET', htu: '/api/fleet-identity', sub: '__probe' });

    await expect(
      service.status(apiKey(token, { method: 'GET', originalUrl: '/api/fleet-identity' })),
    ).resolves.toMatchObject({ verified: true, issuer: 'fleet-test', reason: null, trustedKeys: ['k1'] });
  });

  it('refuses listing / removing trusted fleets through a fleet person on the API key', async () => {
    const { service } = setup([{}]);
    const viaFleet = { apiKeyAuthenticated: true, fleetIdentity: { person: 'fleet:fleet-test:u1' } } as never;

    await expect(service.list(viaFleet)).rejects.toThrow(ForbiddenException);
    await expect(service.remove(viaFleet, 'fleet-test')).rejects.toThrow(ForbiddenException);
    await expect(service.list({ apiKeyAuthenticated: true } as never)).resolves.toHaveLength(1);
  });
});

describe('TrustedFleetsService: management (3.24)', () => {
  it('registers a fleet natively (cluster admins), audited with key fingerprints', async () => {
    const { service, audit, access } = setup([]);
    const dto = await service.put({ user: { id: 'admin', amr: ['pwd'] } } as never, 'fleet-test', {
      name: 'Main fleet',
      keys: [{ kid: 'k1', publicKey: fleet.publicPem }],
    });

    expect(access.assert).toHaveBeenCalledWith(expect.anything(), 'admin');
    expect(dto).toMatchObject({
      issuer: 'fleet-test',
      name: 'Main fleet',
      keys: [{ kid: 'k1', fingerprint: keyFingerprint(fleet.publicPem) }],
    });
    expect(audit).toEqual([
      expect.objectContaining({ action: 'fleet.trust.create', target: 'trusted-fleet/fleet-test' }),
    ]);
  });

  it('refuses listing / removing through a fleet and invalid keys', async () => {
    const { service } = setup([]);

    await expect(service.list({ user: fleetPatUser } as never)).rejects.toThrow(ForbiddenException);
    await expect(service.remove({ user: fleetPatUser } as never, 'fleet-test')).rejects.toThrow(ForbiddenException);
    expect(() => normalizeTrustedFleetKeys([{ kid: 'k1', publicKey: 'nope' }])).toThrow(BadRequestException);
    expect(() =>
      normalizeTrustedFleetKeys([
        { kid: 'k1', publicKey: fleet.publicPem },
        { kid: 'k1', publicKey: fleet.publicPem },
      ]),
    ).toThrow(BadRequestException);
    expect(() => normalizeTrustedFleetKeys([])).toThrow(BadRequestException);
  });

  it('takes a rotated key into account right after a change', async () => {
    const { service } = setup([{}]);
    const next = testFleetKey();
    const admin = { user: { id: 'admin', amr: ['pwd'] } } as never;

    // Warm the cache with the old key only.
    await service.evaluate(request(mintTestClaim(fleet.privateKey, {}, NOW)), true, NOW);
    await service.put(admin, 'fleet-test', {
      name: 'Fleet',
      keys: [
        { kid: 'k1', publicKey: fleet.publicPem },
        { kid: 'k2', publicKey: next.publicPem },
      ],
    });

    await expect(
      service.evaluate(request(mintTestClaim(next.privateKey, { kid: 'k2' }, NOW)), true, NOW),
    ).resolves.toMatchObject({ result: 'verified' });
  });
});

describe('TrustedFleetsService: a fleet registers itself (2026-10-29, automatic trust)', () => {
  const URL = '/api/trusted-fleets/fleet-test';
  const bodyOf = (keys: { kid: string; publicKey: string }[], name = 'Loadweaver fleet') =>
    Buffer.from(JSON.stringify({ name, keys }));
  /** The fleet's own `PUT`: its service user, a claim signed by `signer` over the exact body. */
  const selfPut = (
    service: TrustedFleetsService,
    keys: { kid: string; publicKey: string }[],
    signer = fleet.privateKey,
    claim: Record<string, unknown> = {},
    user: Record<string, unknown> = fleetPatUser,
  ) => {
    const rawBody = bodyOf(keys);
    const token = mintTestClaim(
      signer,
      { htm: 'PUT', htu: URL, sub: 'fleet-admin', role: 'admin', body: rawBody, ...claim },
      NOW,
    );

    return service.put(
      { method: 'PUT', originalUrl: URL, headers: { [FLEET_IDENTITY_HEADER]: token }, rawBody, user } as never,
      'fleet-test',
      { name: 'Loadweaver fleet', keys },
      NOW,
    );
  };

  it('authorized: registers the fleet’s key with the cluster-admin check, audited with the acting fleet person', async () => {
    const { service, audit, access, fleets } = setup([]);

    await expect(selfPut(service, [{ kid: 'k1', publicKey: fleet.publicPem }])).resolves.toMatchObject({
      issuer: 'fleet-test',
      name: 'Loadweaver fleet',
      keys: [{ kid: 'k1', fingerprint: keyFingerprint(fleet.publicPem) }],
      createdBy: 'svc',
    });
    expect(access.assert).toHaveBeenCalledWith(expect.anything(), 'admin');
    expect(fleets).toHaveLength(1);
    expect(audit).toEqual([
      expect.objectContaining({
        action: 'fleet.trust.create',
        target: 'trusted-fleet/fleet-test',
        actor: expect.objectContaining({ id: 'svc', onBehalfOf: 'fleet:fleet-test:fleet-admin' }),
        details: expect.objectContaining({ registeredBy: 'fleet' }),
      }),
    ]);
  });

  it('forbidden: a credential without the cluster-admin role is refused before anything is stored', async () => {
    const { service, access, fleets, audit } = setup([]);

    access.assert.mockRejectedValueOnce(new ForbiddenException('cluster admins only'));
    await expect(selfPut(service, [{ kid: 'k1', publicKey: fleet.publicPem }])).rejects.toThrow(ForbiddenException);
    expect(fleets).toHaveLength(0);
    expect(audit).toEqual([]);
  });

  it('forbidden: no claim, a claim by another key, another issuer, another cluster, a non-admin or a replay', async () => {
    const keys = [{ kid: 'k1', publicKey: fleet.publicPem }];
    const { service } = setup([]);
    const rawBody = bodyOf(keys);

    await expect(
      service.put(
        { method: 'PUT', originalUrl: URL, headers: {}, rawBody, user: fleetPatUser } as never,
        'fleet-test',
        {
          name: 'x',
          keys,
        },
      ),
    ).rejects.toThrow(/signed by the key it registers/);
    await expect(selfPut(service, keys, testFleetKey().privateKey)).rejects.toThrow(/invalid signature/);
    await expect(selfPut(service, keys, fleet.privateKey, { kid: 'k9' })).rejects.toThrow(/one of the keys/);
    await expect(selfPut(service, keys, fleet.privateKey, { iss: 'fleet-other' })).rejects.toThrow(/another fleet/);
    // Cluster identity: a claim minted for another cluster (the fleet's view of the cluster changed) is refused.
    await expect(selfPut(service, keys, fleet.privateKey, { aud: 'cluster-2' })).rejects.toThrow(/another cluster/);
    await expect(selfPut(service, keys, fleet.privateKey, { role: 'operator' })).rejects.toThrow(/admins/);
    await expect(selfPut(service, keys, fleet.privateKey, { jti: 'a'.repeat(32) })).resolves.toBeDefined();
    await expect(selfPut(service, keys, fleet.privateKey, { jti: 'a'.repeat(32) })).rejects.toThrow(/replayed/);
  });

  it('already trusted: nothing is written or audited', async () => {
    const { service, audit, dataSource } = setup([{ createdBy: 'admin' }]);

    await expect(selfPut(service, [{ kid: 'k1', publicKey: fleet.publicPem }])).resolves.toMatchObject({
      name: 'Fleet',
      keys: [{ kid: 'k1' }],
    });
    expect(audit).toEqual([]);
    expect(dataSource.transaction).toHaveBeenCalled();
  });

  it('rotation: the next key is added next to the trusted one (kept until an admin removes it)', async () => {
    const { service, audit, fleets } = setup([{ createdBy: 'admin' }]);
    const next = testFleetKey();

    await selfPut(service, [
      { kid: 'k1', publicKey: fleet.publicPem },
      { kid: 'k2', publicKey: next.publicPem },
    ]);
    expect(fleets[0].keys.map((k) => k.kid)).toEqual(['k1', 'k2']);
    // After the fleet activated k2 it registers only k2: k1 stays (the rotation's grace is the cluster admin's call).
    await selfPut(service, [{ kid: 'k2', publicKey: next.publicPem }], next.privateKey, { kid: 'k2' });
    expect(fleets[0].keys.map((k) => k.kid).sort()).toEqual(['k1', 'k2']);
    expect(audit).toEqual([expect.objectContaining({ action: 'fleet.trust.update' })]);
    // The name an admin gave the entry is kept.
    expect(fleets[0].name).toBe('Fleet');
  });

  it('never takes over an entry it can’t sign for, unless this service user registered it', async () => {
    const intruder = testFleetKey();
    const keys = [{ kid: 'k7', publicKey: intruder.publicPem }];

    await expect(
      selfPut(setup([{ createdBy: 'admin' }]).service, keys, intruder.privateKey, { kid: 'k7' }),
    ).rejects.toThrow(/registered here with other keys/);
    // Its own earlier registration (e.g. a key activated before it was registered): recoverable by the same credential.
    await expect(
      selfPut(setup([{ createdBy: 'svc' }]).service, keys, intruder.privateKey, { kid: 'k7' }),
    ).resolves.toMatchObject({ keys: expect.arrayContaining([expect.objectContaining({ kid: 'k7' })]) });
  });

  it('reports the trusted key ids and since when to a verified probe', async () => {
    const { service } = setup([{}]);
    const token = mintTestClaim(fleet.privateKey, { htm: 'GET', htu: '/api/fleet-identity' });

    await expect(
      service.status({
        method: 'GET',
        originalUrl: '/api/fleet-identity',
        headers: { [FLEET_IDENTITY_HEADER]: token },
        user: fleetPatUser,
      } as never),
    ).resolves.toMatchObject({ verified: true, trustedKeys: ['k1'], trustedSince: NOW.toISOString() });
  });

  it('merges keys: the fleet’s first, then the stored ones newest first, at most three', () => {
    const at = (d: string) => `2026-10-${d}T00:00:00.000Z`;

    expect(
      mergeTrustedFleetKeys(
        [
          { kid: 'a', publicKey: 'A', addedAt: at('01') },
          { kid: 'b', publicKey: 'B', addedAt: at('03') },
          { kid: 'c', publicKey: 'C', addedAt: at('02') },
        ],
        [
          { kid: 'c', publicKey: 'C2' },
          { kid: 'd', publicKey: 'D' },
        ],
      ),
    ).toEqual([
      { kid: 'c', publicKey: 'C2' },
      { kid: 'd', publicKey: 'D' },
      { kid: 'b', publicKey: 'B' },
    ]);
  });
});
