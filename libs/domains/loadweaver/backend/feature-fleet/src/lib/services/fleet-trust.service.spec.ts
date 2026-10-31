import type { FleetClusterEntity, FleetClusterHealth } from '../entities/fleet-cluster.entity';
import { FleetClusterError } from './fleet-cluster-client.service';
import { FleetTrustService, mergeRegistrationKeys, shouldAttemptTrust, trustRevoked } from './fleet-trust.service';

const admin = { userId: 'u-admin', isApiKey: false, isAdmin: true, label: 'fleet:admin@example.com' };
const REGISTRATION = {
  issuer: 'fleet-1',
  name: 'Loadweaver fleet',
  keys: [{ kid: 'k-active', publicKey: 'PEM-ACTIVE', fingerprint: 'SHA256:a' }],
};

const healthy = (over: Partial<FleetClusterHealth> = {}): FleetClusterHealth => ({
  state: 'healthy',
  checkedAt: '2026-10-29T10:00:00.000Z',
  latencyMs: 5,
  version: '1.0.0',
  clusterId: 'cl-1',
  error: null,
  identity: 'untrusted',
  identityReason: 'fleet fleet-1 is not trusted by this cluster',
  pinnedClusterId: 'cl-1',
  ...over,
});

const clusterRow = (health: FleetClusterHealth = healthy()): FleetClusterEntity =>
  ({
    id: 'c1',
    name: 'eu',
    endpoint: 'https://eu.example.com',
    caCertificate: null,
    credential: 'lwp_service-credential',
    credentialHint: '…tial',
    state: 'active',
    health,
    updatedAt: new Date(),
  }) as FleetClusterEntity;

type Call = { method: string; path: string; credential: string; body?: Buffer; identity?: string | null };

/**
 * A fake cluster: `GET cluster` answers its id, `GET fleet-identity` the trust state, `PUT trusted-fleets/…` decides
 * by the credential (the cluster's own authorisation).
 */
function setup(options: {
  clusterId?: string;
  verified?: boolean;
  trustedKeys?: string[] | null;
  putStatus?: number;
  identityStatus?: number;
  listed?: unknown[];
}) {
  const calls: Call[] = [];
  const client = {
    json: jest.fn(async (conn: { credential: string }, req: Call) => {
      calls.push({ ...req, credential: conn.credential });

      if (req.path === 'cluster') return { data: { clusterId: options.clusterId ?? 'cl-1' }, headers: {} };

      if (req.path === 'fleet-identity') {
        if (options.identityStatus) throw new FleetClusterError('HTTP', options.identityStatus);

        const verified = options.verified ?? false;

        return {
          data: {
            clusterId: options.clusterId ?? 'cl-1',
            verified,
            reason: verified ? null : 'fleet fleet-1 is not trusted by this cluster',
            trustedKeys: verified ? (options.trustedKeys ?? ['k-active']) : null,
            trustedSince: verified ? '2026-10-29T10:01:00.000Z' : null,
          },
          headers: {},
        };
      }

      if (req.method === 'GET' && req.path === 'trusted-fleets') return { data: options.listed ?? [], headers: {} };

      if (req.method === 'PUT') {
        if (options.putStatus && options.putStatus >= 400)
          throw new FleetClusterError('admin role required', options.putStatus);

        // After the registration the probe verifies.
        options.verified = true;

        return { data: {}, headers: {} };
      }

      throw new Error(`unexpected ${req.method} ${req.path}`);
    }),
  };
  const updates: Record<string, unknown>[] = [];
  const clusters = { update: jest.fn(async (_w: unknown, patch: Record<string, unknown>) => updates.push(patch)) };
  const identity = {
    registration: jest.fn(async () => REGISTRATION),
    probeClaim: jest.fn(async (aud: string) => `probe-for-${aud}`),
    registrationClaim: jest.fn(async (_c: unknown, aud: string, url: string) => `proof-for-${aud}-${url}`),
  };
  const audit = { recordQuietly: jest.fn() };
  const service = new FleetTrustService(clusters as never, client as never, identity as never, audit as never);

  return { service, calls, updates, audit, identity };
}

describe('FleetTrustService: establishing trust (2026-10-29)', () => {
  it('authorized: registers exactly the fleet’s keys with the connection’s credential and a proof claim, audited', async () => {
    const { service, calls, audit, identity } = setup({});
    const cluster = clusterRow();
    const { attempt, health } = await service.establish(cluster, admin);

    expect(attempt).toMatchObject({
      state: 'established',
      via: 'service-credential',
      by: 'u-admin',
      keyIds: ['k-active'],
    });
    const put = calls.find((c) => c.method === 'PUT');

    expect(put).toMatchObject({ path: 'trusted-fleets/fleet-1', credential: 'lwp_service-credential' });
    expect(JSON.parse(put?.body?.toString() ?? '{}')).toEqual({
      name: 'Loadweaver fleet',
      keys: [{ kid: 'k-active', publicKey: 'PEM-ACTIVE' }],
    });
    // The proof is bound to the cluster's id and this exact request and body.
    expect(identity.registrationClaim).toHaveBeenCalledWith(admin, 'cl-1', '/api/trusted-fleets/fleet-1', put?.body);
    expect(put?.identity).toBe('proof-for-cl-1-/api/trusted-fleets/fleet-1');
    expect(health).toMatchObject({ identity: 'verified', identitySince: '2026-10-29T10:01:00.000Z' });
    expect(audit.recordQuietly).toHaveBeenCalledWith(
      admin,
      'identity.trust-established',
      'cluster/c1/trust',
      expect.objectContaining({ issuer: 'fleet-1', via: 'service-credential', outcome: 'established' }),
      'c1',
    );
  });

  it('re-probes right after the registration: the identity is confirmed now, not at the next poll', async () => {
    const { service } = setup({});
    const { attempt, health } = await service.establish(clusterRow(), admin);

    expect(health.identity).toBe('verified');
    expect(health.identityCheckedAt).toBeDefined();
    // The cluster's answer is newer than the attempt: the console shows one state (Trusted), not a stale one.
    expect(new Date(health.identityCheckedAt ?? 0).getTime()).toBeGreaterThanOrEqual(new Date(attempt.at).getTime());
  });

  it('re-probe unanswered: the older identity and its check time stay, so the attempt reads as unconfirmed', async () => {
    const { service } = setup({});
    const cluster = clusterRow(healthy({ identityCheckedAt: '2026-10-29T09:00:00.000Z' }));
    let probes = 0;
    const client = (service as unknown as { client: { json: jest.Mock } }).client;
    const original = client.json.getMockImplementation() as (...args: unknown[]) => Promise<unknown>;

    // The first probe (already trusted?) answers; the one after the registration doesn't.
    client.json.mockImplementation(async (conn: unknown, req: { path: string }) => {
      if (req.path === 'fleet-identity' && ++probes > 1) throw new Error('socket hang up');

      return await original(conn, req);
    });
    const { attempt, health } = await service.establish(cluster, admin);

    expect(attempt.state).toBe('established');
    expect(health).toMatchObject({ identity: 'untrusted', identityCheckedAt: '2026-10-29T09:00:00.000Z' });
  });

  it('automatic (no caller): audited as the system', async () => {
    const { service, audit } = setup({});

    await expect(service.establish(clusterRow(), null)).resolves.toMatchObject({
      attempt: { state: 'established', by: null },
    });
    expect(audit.recordQuietly).toHaveBeenCalledWith(
      null,
      'identity.trust-established',
      expect.any(String),
      expect.anything(),
      'c1',
    );
  });

  it('forbidden: the credential may not manage trusted fleets → shown honestly, nothing else changes', async () => {
    const { service, audit, updates } = setup({ putStatus: 403 });
    const { attempt, health } = await service.establish(clusterRow(), admin);

    expect(attempt).toMatchObject({ state: 'forbidden', credentialHint: '…tial' });
    expect(attempt.reason).toMatch(/may not manage trusted fleets/);
    expect(health.identity).toBe('untrusted');
    expect(updates[0]).toMatchObject({ health: expect.objectContaining({ trust: attempt }) });
    expect(audit.recordQuietly).toHaveBeenCalledWith(
      admin,
      'identity.trust-refused',
      'cluster/c1/trust',
      expect.objectContaining({ outcome: 'forbidden' }),
      'c1',
    );
  });

  it('forbidden automatically: no fleet audit entry every poll', async () => {
    const { service, audit } = setup({ putStatus: 403 });

    await service.establish(clusterRow(), null);
    expect(audit.recordQuietly).not.toHaveBeenCalled();
  });

  it('cluster identity mismatch: another cluster id than the pinned one → nothing is registered', async () => {
    const { service, calls } = setup({ clusterId: 'cl-OTHER' });
    const { attempt } = await service.establish(clusterRow(), admin);

    expect(attempt.state).toBe('identity-mismatch');
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('already trusted: no write, no audit (idempotent)', async () => {
    const { service, calls, audit } = setup({ verified: true });

    await expect(service.establish(clusterRow(healthy({ identity: 'verified' })), admin)).resolves.toMatchObject({
      attempt: { state: 'already-trusted' },
    });
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
    expect(audit.recordQuietly).not.toHaveBeenCalled();
  });

  it('rotation: verified but the next key is missing → registers active + next', async () => {
    const { service, calls, identity } = setup({ verified: true, trustedKeys: ['k-active'] });

    identity.registration.mockResolvedValue({
      ...REGISTRATION,
      keys: [...REGISTRATION.keys, { kid: 'k-next', publicKey: 'PEM-NEXT', fingerprint: 'SHA256:n' }],
    });
    await expect(service.establish(clusterRow(healthy({ identity: 'verified' })), admin)).resolves.toMatchObject({
      attempt: { state: 'established', keyIds: ['k-active', 'k-next'] },
    });
    const put = calls.find((c) => c.method === 'PUT');

    expect(JSON.parse(put?.body?.toString() ?? '{}').keys.map((k: { kid: string }) => k.kid)).toEqual([
      'k-active',
      'k-next',
    ]);
  });

  it('one-time token: used only for this call (never stored), keeps the cluster’s other keys', async () => {
    const { service, calls, updates } = setup({
      putStatus: 0,
      listed: [
        {
          issuer: 'fleet-1',
          name: 'Our fleet',
          keys: [{ kid: 'k-old', publicKey: 'PEM-OLD', addedAt: '2026-10-01T00:00:00.000Z' }],
        },
      ],
    });
    const cluster = clusterRow();
    const { attempt } = await service.establish(cluster, admin, { adminToken: '  lwp_admin-once  ' });

    expect(attempt).toMatchObject({ state: 'established', via: 'one-time-token' });
    const put = calls.find((c) => c.method === 'PUT');

    expect(put?.credential).toBe('lwp_admin-once');
    expect(JSON.parse(put?.body?.toString() ?? '{}')).toEqual({
      name: 'Our fleet',
      keys: [
        { kid: 'k-active', publicKey: 'PEM-ACTIVE' },
        { kid: 'k-old', publicKey: 'PEM-OLD' },
      ],
    });
    // The fleet's own probe keeps using the stored credential; the token appears nowhere in what is stored.
    expect(
      calls.filter((c) => c.path === 'fleet-identity').every((c) => c.credential === 'lwp_service-credential'),
    ).toBe(true);
    expect(cluster.credential).toBe('lwp_service-credential');
    expect(JSON.stringify(updates)).not.toContain('lwp_admin-once');
  });

  it('one-time token without the right: forbidden', async () => {
    const { service } = setup({ putStatus: 403 });

    await expect(service.establish(clusterRow(), admin, { adminToken: 'lwp_viewer' })).resolves.toMatchObject({
      attempt: { state: 'forbidden', via: 'one-time-token' },
    });
  });

  it('older clusters: unsupported', async () => {
    const { service } = setup({ identityStatus: 404 });

    await expect(service.establish(clusterRow(), admin)).resolves.toMatchObject({ attempt: { state: 'unsupported' } });
  });

  it('refuses retired clusters', async () => {
    const { service } = setup({});

    await expect(service.establish({ ...clusterRow(), state: 'retired' } as FleetClusterEntity, admin)).rejects.toThrow(
      /retired/,
    );
  });
});

describe('automatic trust: when the poll tries (2026-10-29)', () => {
  const cluster = { state: 'active', credentialHint: '…tial' } as FleetClusterEntity;
  const attempt = (state: string, over: Record<string, unknown> = {}) =>
    ({
      state,
      at: '2026-10-29T10:00:00.000Z',
      via: 'service-credential',
      by: null,
      reason: null,
      credentialHint: '…tial',
      keyIds: ['k1'],
      ...over,
    }) as FleetClusterHealth['trust'];
  const now = new Date('2026-10-29T10:05:00.000Z');

  afterEach(() => delete process.env['FLEET_AUTO_TRUST']);

  it('tries once for an untrusting cluster, then not again with the same credential and keys', () => {
    expect(shouldAttemptTrust(cluster, healthy(), ['k1'], now)).toBe(true);
    expect(shouldAttemptTrust(cluster, healthy({ trust: attempt('forbidden') }), ['k1'], now)).toBe(false);
    expect(shouldAttemptTrust(cluster, healthy({ trust: attempt('identity-mismatch') }), ['k1'], now)).toBe(false);
    // A new credential or a new key retries.
    expect(
      shouldAttemptTrust(cluster, healthy({ trust: attempt('forbidden', { credentialHint: '…old' }) }), ['k1'], now),
    ).toBe(true);
    expect(shouldAttemptTrust(cluster, healthy({ trust: attempt('forbidden') }), ['k1', 'k2'], now)).toBe(true);
    // Failures after 15 minutes.
    expect(shouldAttemptTrust(cluster, healthy({ trust: attempt('failed') }), ['k1'], now)).toBe(false);
    expect(
      shouldAttemptTrust(cluster, healthy({ trust: attempt('failed') }), ['k1'], new Date('2026-10-29T10:20:00.000Z')),
    ).toBe(true);
  });

  it('never re-registers after a cluster admin revoked the trust', () => {
    expect(shouldAttemptTrust(cluster, healthy({ trust: attempt('revoked') }), ['k1'], now)).toBe(false);
    expect(
      trustRevoked(
        healthy({ identity: 'verified' }),
        healthy({ identity: 'untrusted', identityReason: 'fleet fleet-1 is not trusted by this cluster' }),
      ),
    ).toBe(true);
    // An unregistered key after rotation is no revocation.
    expect(
      trustRevoked(
        healthy({ identity: 'verified' }),
        healthy({ identity: 'untrusted', identityReason: 'key k2 of fleet fleet-1 is not registered' }),
      ),
    ).toBe(false);
  });

  it('only for working connections with a known cluster id, and only when switched on', () => {
    expect(shouldAttemptTrust(cluster, healthy({ state: 'unreachable' }), ['k1'], now)).toBe(false);
    expect(shouldAttemptTrust(cluster, healthy({ clusterId: null }), ['k1'], now)).toBe(false);
    expect(shouldAttemptTrust(cluster, healthy({ identity: 'unsupported' }), ['k1'], now)).toBe(false);
    expect(shouldAttemptTrust(cluster, healthy({ identity: 'verified', identityKeys: ['k1'] }), ['k1'], now)).toBe(
      false,
    );
    expect(
      shouldAttemptTrust(cluster, healthy({ identity: 'verified', identityKeys: ['k1'] }), ['k1', 'k2'], now),
    ).toBe(true);
    process.env['FLEET_AUTO_TRUST'] = 'false';
    expect(shouldAttemptTrust(cluster, healthy(), ['k1'], now)).toBe(false);
  });

  it('merges the one-time token’s keys: the fleet’s first, then the cluster’s others newest first, at most three', () => {
    expect(
      mergeRegistrationKeys(
        {
          ...REGISTRATION,
          keys: [
            { kid: 'a', publicKey: 'A', fingerprint: '' },
            { kid: 'b', publicKey: 'B', fingerprint: '' },
          ],
        },
        {
          keys: [
            { kid: 'x', publicKey: 'X', addedAt: '2026-01-01' },
            { kid: 'y', publicKey: 'Y', addedAt: '2026-02-01' },
            { kid: 'a', publicKey: 'A-old', addedAt: '2026-03-01' },
          ],
        },
      ),
    ).toEqual([
      { kid: 'a', publicKey: 'A' },
      { kid: 'b', publicKey: 'B' },
      { kid: 'y', publicKey: 'Y' },
    ]);
  });
});
