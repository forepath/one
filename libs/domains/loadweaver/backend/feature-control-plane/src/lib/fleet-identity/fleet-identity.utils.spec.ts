import { ForbiddenException } from '@nestjs/common';

import { mintTestClaim, testFleetKey } from './fleet-identity.testing';
import {
  API_KEY_FLEET_DELEGATION_ENV,
  apiKeyFleetDelegationEnabled,
  assertFleetApprovalIdentity,
  assertFleetKitIdentity,
  assertNotLegacyFleetItem,
  capRolesToFleetIdentity,
  checkFleetClaim,
  decodeFleetClaim,
  declaredContent,
  ed25519PublicKey,
  expectedBodyBinding,
  fleetBodyHash,
  fleetIdentityIgnoredReason,
  fleetPersonId,
  fleetStreamBinding,
  isFleetPerson,
  isFleetRelayCaller,
  mayCarryFleetIdentity,
  type VerifiedFleetIdentity,
} from './fleet-identity.utils';

const NOW = new Date('2026-10-26T12:00:00.000Z');
const fleet = testFleetKey();
const expected = (overrides: Partial<Parameters<typeof checkFleetClaim>[1]> = {}) => ({
  key: fleet.publicKey,
  audience: 'cluster-1',
  method: 'POST',
  url: '/api/plans/p1/approve',
  bodyHash: fleetBodyHash(),
  now: NOW,
  ...overrides,
});

const decoded = (token: string) => {
  const result = decodeFleetClaim(token);

  if (!result) throw new Error('undecodable claim');

  return result;
};

const identity = (overrides: Partial<VerifiedFleetIdentity> = {}): VerifiedFleetIdentity => ({
  person: 'fleet:fleet-test:u1',
  issuer: 'fleet-test',
  subject: 'u1',
  email: 'alice@example.com',
  emailVerified: true,
  role: 'admin',
  projects: {},
  jti: 'j'.repeat(32),
  expiresAt: NOW,
  ...overrides,
});

describe('fleet identity claims (3.24)', () => {
  it('verifies a claim bound to the cluster, the request and the body', () => {
    const body = Buffer.from('{"x":1}');
    const decoded = decodeFleetClaim(mintTestClaim(fleet.privateKey, { body }, NOW));
    const check = decoded && checkFleetClaim(decoded, expected({ bodyHash: fleetBodyHash(body) }));

    expect(check).toMatchObject({
      ok: true,
      identity: { person: 'fleet:fleet-test:u1', email: 'alice@example.com', emailVerified: true, role: 'admin' },
    });
  });

  it.each([
    ['another key', () => checkFleetClaim(decoded(mintTestClaim(testFleetKey().privateKey, {}, NOW)), expected())],
    [
      'another cluster',
      () => checkFleetClaim(decoded(mintTestClaim(fleet.privateKey, { aud: 'c2' }, NOW)), expected()),
    ],
    [
      'another method',
      () => checkFleetClaim(decoded(mintTestClaim(fleet.privateKey, {}, NOW)), expected({ method: 'DELETE' })),
    ],
    [
      'another URL',
      () =>
        checkFleetClaim(decoded(mintTestClaim(fleet.privateKey, {}, NOW)), expected({ url: '/api/plans/p2/approve' })),
    ],
    [
      'another body',
      () =>
        checkFleetClaim(
          decoded(mintTestClaim(fleet.privateKey, {}, NOW)),
          expected({ bodyHash: fleetBodyHash(Buffer.from('x')) }),
        ),
    ],
    [
      'an expired claim',
      () =>
        checkFleetClaim(decoded(mintTestClaim(fleet.privateKey, {}, new Date(NOW.getTime() - 120_000))), expected()),
    ],
    [
      'a claim from the future',
      () =>
        checkFleetClaim(decoded(mintTestClaim(fleet.privateKey, {}, new Date(NOW.getTime() + 120_000))), expected()),
    ],
    [
      'a too long lifetime',
      () => {
        const iat = Math.floor(NOW.getTime() / 1000);

        return checkFleetClaim(decoded(mintTestClaim(fleet.privateKey, { iat, exp: iat + 3600 }, NOW)), expected());
      },
    ],
  ])('refuses %s', (_name, run) => {
    expect(run()).toMatchObject({ ok: false });
  });

  it('refuses a tampered payload', () => {
    const [header, , signature] = mintTestClaim(fleet.privateKey, {}, NOW).split('.');
    const forged = Buffer.from(
      JSON.stringify({
        iss: 'fleet-test',
        aud: 'cluster-1',
        sub: 'mallory',
        role: 'admin',
        htm: 'POST',
        htu: '/api/plans/p1/approve',
        bh: fleetBodyHash(),
        iat: 1,
        exp: 2,
        jti: 'x'.repeat(20),
      }),
    ).toString('base64url');
    const decoded = decodeFleetClaim(`${header}.${forged}.${signature}`);

    expect(decoded && checkFleetClaim(decoded, expected())).toMatchObject({ ok: false });
  });

  it('decodes only well-formed EdDSA claims', () => {
    expect(decodeFleetClaim('a.b')).toBeNull();
    expect(decodeFleetClaim('x'.repeat(20_000))).toBeNull();
    expect(decodeFleetClaim(mintTestClaim(fleet.privateKey, { role: 'root' as never }, NOW))).toBeNull();
    expect(decodeFleetClaim(mintTestClaim(fleet.privateKey, { prj: { 'Bad Name': 'admin' } }, NOW))).toBeNull();
    expect(decodeFleetClaim(mintTestClaim(fleet.privateKey, { jti: 'short' }, NOW))).toBeNull();

    const none = `${Buffer.from(JSON.stringify({ alg: 'none', kid: 'k1' })).toString('base64url')}.e30.sig`;

    expect(decodeFleetClaim(none)).toBeNull();
  });

  it('only accepts Ed25519 keys and names persons fleet:<iss>:<sub>', () => {
    expect(ed25519PublicKey(fleet.publicPem)).not.toBeNull();
    expect(ed25519PublicKey('not a key')).toBeNull();
    expect(fleetPersonId('f', 'u')).toBe('fleet:f:u');
    expect(isFleetPerson('fleet:f:u')).toBe(true);
    expect(isFleetPerson('6f1c1b0e-0000-4000-8000-000000000001')).toBe(false);
  });
});

describe('fleet person roles: grant mapped, capped by the service user (3.24)', () => {
  const service = (
    clusterRole?: 'cluster-admin' | 'infra-operator' | 'auditor',
    projects: Record<string, string> = {},
  ) => ({
    clusterRole,
    projects: new Map(Object.entries(projects)) as never,
  });

  it('gives a fleet admin cluster admin only when the service user is one', () => {
    expect(capRolesToFleetIdentity(service('cluster-admin'), identity()).clusterRole).toBe('cluster-admin');
    expect(capRolesToFleetIdentity(service('auditor'), identity()).clusterRole).toBe('auditor');
  });

  it('never widens: a viewer grant stays auditor / project viewer under a cluster-admin service user', () => {
    const roles = capRolesToFleetIdentity(service('cluster-admin'), identity({ role: 'viewer' }));

    expect(roles.clusterRole).toBe('auditor');
    expect(roles.allProjects).toBe('viewer');
  });

  it('maps cluster-wide operator to project operator everywhere and keeps higher project grants', () => {
    const roles = capRolesToFleetIdentity(
      service('cluster-admin'),
      identity({ role: 'operator', projects: { shop: 'admin' } }),
    );

    expect(roles.clusterRole).toBe('infra-operator');
    expect(roles.allProjects).toBe('operator');
    expect(roles.projects.get('shop')).toBe('admin');
  });

  it('caps project grants by the service user’s project roles', () => {
    const roles = capRolesToFleetIdentity(
      service(undefined, { shop: 'operator' }),
      identity({ role: null, projects: { shop: 'admin', blog: 'admin' } }),
    );

    expect(roles.clusterRole).toBeUndefined();
    expect(roles.allProjects).toBeUndefined();
    expect(roles.projects.get('shop')).toBe('operator');
    expect(roles.projects.has('blog')).toBe(false);
  });
});

describe('API key fleet delegation (2026-10-29, user decision)', () => {
  const scope = 'fleet:on-behalf-of';
  const key = { apiKeyAuthenticated: true } as never;
  const fleetPat = { user: { id: 'svc', amr: ['pat'], scopes: [scope] } } as never;
  const plainPat = { user: { id: 'svc', amr: ['pat'], scopes: ['cluster:read'] } } as never;

  it('is on by default; off / false / 0 / no turn it off', () => {
    expect(apiKeyFleetDelegationEnabled({})).toBe(true);
    expect(apiKeyFleetDelegationEnabled({ [API_KEY_FLEET_DELEGATION_ENV]: 'on' })).toBe(true);

    for (const value of ['off', 'OFF', 'false', '0', 'no', ' off '])
      expect(apiKeyFleetDelegationEnabled({ [API_KEY_FLEET_DELEGATION_ENV]: value })).toBe(false);
  });

  it('lets the API key carry claims while on; PATs need the scope as before', () => {
    expect(mayCarryFleetIdentity(key, scope, true)).toBe(true);
    expect(mayCarryFleetIdentity(key, scope, false)).toBe(false);
    expect(mayCarryFleetIdentity(fleetPat, scope, false)).toBe(true);
    expect(mayCarryFleetIdentity(plainPat, scope, true)).toBe(false);
    expect(mayCarryFleetIdentity({ user: { id: 'u', amr: ['pwd'] } } as never, scope, true)).toBe(false);
    // The API key is never a fleet relay caller: without a claim it keeps its native behaviour.
    expect(isFleetRelayCaller(key, scope)).toBe(false);
  });

  it('explains why a claim is ignored', () => {
    expect(fleetIdentityIgnoredReason(key, scope, false)).toBe(
      `API key fleet delegation is off on this cluster (${API_KEY_FLEET_DELEGATION_ENV})`,
    );
    expect(fleetIdentityIgnoredReason(plainPat, scope, true)).toBe(
      'only PATs with fleet:on-behalf-of or the cluster API key send fleet identities',
    );
    expect(fleetIdentityIgnoredReason(plainPat, scope, false)).toBe(
      'only PATs with fleet:on-behalf-of send fleet identities',
    );
  });

  it('caps the person at the API key’s own rights (cluster admin): the claim narrows, never widens', () => {
    const apiKeyRoles = { clusterRole: 'cluster-admin' as const, projects: new Map() };

    expect(capRolesToFleetIdentity(apiKeyRoles, identity()).clusterRole).toBe('cluster-admin');

    const viewer = capRolesToFleetIdentity(apiKeyRoles, identity({ role: 'viewer', projects: { shop: 'admin' } }));

    expect(viewer.clusterRole).toBe('auditor');
    expect(viewer.allProjects).toBe('viewer');
    expect(viewer.projects.get('shop')).toBe('admin');

    const none = capRolesToFleetIdentity(apiKeyRoles, identity({ role: null, projects: {} }));

    expect(none.clusterRole).toBeUndefined();
    expect(none.allProjects).toBeUndefined();
    expect(none.projects.size).toBe(0);
  });
});

describe('approval guards (3.24)', () => {
  const fleetPat = { user: { id: 'svc', amr: ['pat'], scopes: ['fleet:on-behalf-of'] } } as never;

  it('refuses approvals by a fleet service user without a verified person', () => {
    expect(() => assertFleetApprovalIdentity(fleetPat, 'fleet:on-behalf-of')).toThrow(ForbiddenException);
    expect(() =>
      assertFleetApprovalIdentity(
        { ...(fleetPat as object), fleetIdentity: identity() } as never,
        'fleet:on-behalf-of',
      ),
    ).not.toThrow();
    // Native sessions and PATs without the scope are unaffected.
    expect(() =>
      assertFleetApprovalIdentity({ user: { id: 'u', amr: ['pwd'] } } as never, 'fleet:on-behalf-of'),
    ).not.toThrow();
  });

  it('API key: no claim → native as before; with a verified person the two-person guards apply (2026-10-29)', () => {
    const key = { apiKeyAuthenticated: true } as never;
    const keyWithPerson = { apiKeyAuthenticated: true, fleetIdentity: identity() } as never;

    expect(() => assertFleetApprovalIdentity(key, 'fleet:on-behalf-of')).not.toThrow();
    expect(() => assertFleetApprovalIdentity(keyWithPerson, 'fleet:on-behalf-of')).not.toThrow();
    // Items the API key created without a person (e.g. through the fleet before delegation) stay native-only.
    expect(() => assertNotLegacyFleetItem(keyWithPerson, 'api-key', undefined)).toThrow(ForbiddenException);
    expect(() => assertNotLegacyFleetItem(keyWithPerson, 'fleet:fleet-test:u2', undefined)).not.toThrow();
    expect(() => assertNotLegacyFleetItem(key, 'api-key', undefined)).not.toThrow();
  });

  it('refuses recovery-kit handling by a fleet service user without a verified person (2026-10-30)', () => {
    expect(() => assertFleetKitIdentity(fleetPat, 'fleet:on-behalf-of')).toThrow(
      /the recovery kit through a fleet needs a verified fleet identity/,
    );
    expect(() =>
      assertFleetKitIdentity({ ...(fleetPat as object), fleetIdentity: identity() } as never, 'fleet:on-behalf-of'),
    ).not.toThrow();
    // Native sessions and the API key used natively (no claim) are unaffected.
    expect(() =>
      assertFleetKitIdentity({ user: { id: 'u', amr: ['pwd'] } } as never, 'fleet:on-behalf-of'),
    ).not.toThrow();
    expect(() => assertFleetKitIdentity({ apiKeyAuthenticated: true } as never, 'fleet:on-behalf-of')).not.toThrow();
  });

  it('keeps items created through the fleet before claims native-only', () => {
    const req = { user: { id: 'svc' }, fleetIdentity: identity() } as never;

    expect(() => assertNotLegacyFleetItem(req, 'svc', 'svc')).toThrow(ForbiddenException);
    expect(() => assertNotLegacyFleetItem(req, 'fleet:fleet-test:u2', 'svc')).not.toThrow();
    expect(() => assertNotLegacyFleetItem({ user: { id: 'svc' } } as never, 'svc', 'svc')).not.toThrow();
  });
});

describe('stream binding of uploads (2026-10-27)', () => {
  const digest = 'ab'.repeat(32);
  const headers = { 'content-length': '1048576', 'x-loadweaver-content-sha256': digest.toUpperCase() };

  it('reads the declared length + SHA-256', () => {
    expect(declaredContent(headers)).toEqual({ length: 1048576, sha256: digest });
    expect(declaredContent({ 'content-length': '10' })).toBeNull();
    expect(declaredContent({ ...headers, 'x-loadweaver-content-sha256': 'xyz' })).toBeNull();
    expect(declaredContent({ ...headers, 'content-length': '0' })).toBeNull();
  });

  it('binds the declaration only on stream routes without a buffered body', () => {
    expect(expectedBodyBinding({ method: 'POST', originalUrl: '/api/updates/bundles', headers } as never)).toBe(
      fleetStreamBinding(1048576, digest),
    );
    expect(fleetStreamBinding(1048576, digest)).toBe(`stream:1048576:${digest}`);
    // Other routes, missing headers or a buffered JSON body: the body hash as before.
    expect(expectedBodyBinding({ method: 'POST', originalUrl: '/api/plans', headers } as never)).toBe(fleetBodyHash());
    expect(expectedBodyBinding({ method: 'POST', originalUrl: '/api/updates/bundles', headers: {} } as never)).toBe(
      fleetBodyHash(),
    );
    expect(
      expectedBodyBinding({
        method: 'POST',
        originalUrl: '/api/updates/bundles',
        headers,
        rawBody: Buffer.from('{}'),
      } as never),
    ).toBe(fleetBodyHash(Buffer.from('{}')));
  });

  it('verifies a claim bound to the declaration', () => {
    const binding = fleetStreamBinding(1048576, digest);
    const token = mintTestClaim(fleet.privateKey, { htu: '/api/updates/bundles', bh: binding }, NOW);

    expect(checkFleetClaim(decoded(token), expected({ url: '/api/updates/bundles', bodyHash: binding })).ok).toBe(true);
    expect(
      checkFleetClaim(
        decoded(token),
        expected({ url: '/api/updates/bundles', bodyHash: fleetStreamBinding(1048577, digest) }),
      ),
    ).toMatchObject({ ok: false, reason: 'body mismatch' });
  });
});
