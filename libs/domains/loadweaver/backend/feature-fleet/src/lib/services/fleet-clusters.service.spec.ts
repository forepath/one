import { getMetadataArgsStorage } from 'typeorm';

import { FleetClusterEntity } from '../entities/fleet-cluster.entity';
import { NO_ACCESS } from '../utils/fleet-access.utils';
import { FleetClusterError } from './fleet-cluster-client.service';
import { credentialHint, FleetClustersService, toClusterDto } from './fleet-clusters.service';

const caller = { userId: 'admin', isApiKey: false, isAdmin: true, label: 'fleet:admin' };

function setup(probe: () => Promise<{ data: unknown; headers: Record<string, unknown> }>) {
  const saved: Record<string, unknown>[] = [];
  const clusters = {
    exists: jest.fn(async () => false),
    create: (v: Record<string, unknown>) => v,
    save: jest.fn(async (v: Record<string, unknown>) => {
      const row = { id: 'c1', createdAt: new Date(), updatedAt: new Date(), ...v };

      saved.push(row);

      return row;
    }),
    findOne: jest.fn(),
    update: jest.fn(),
  };
  const client = { json: jest.fn(probe) };
  const audit = { record: jest.fn(), recordQuietly: jest.fn() };
  const service = new FleetClustersService(
    clusters as never,
    {} as never,
    {} as never,
    client as never,
    audit as never,
  );

  return { service, saved, audit, client };
}

describe('cluster connections (3.24)', () => {
  it('stores the credential through the AES-256-GCM column transformer', () => {
    const column = getMetadataArgsStorage().columns.find(
      (c) => c.target === FleetClusterEntity && c.propertyName === 'credential',
    );
    const transformer = column?.options.transformer as { to(v: string): string; from(v: string): string };
    const encrypted = transformer.to('lwp_secret-token-value');

    expect(encrypted).not.toContain('secret-token');
    expect(encrypted.split(':')).toHaveLength(3);
    expect(transformer.from(encrypted)).toBe('lwp_secret-token-value');
    expect(transformer.to('lwp_secret-token-value')).not.toBe(encrypted);
  });

  it('never returns the credential, only its hint', () => {
    const dto = toClusterDto(
      {
        id: 'c1',
        name: 'eu',
        description: null,
        endpoint: 'https://eu.example.com',
        caCertificate: null,
        credential: 'lwp_secret-token-value',
        credentialHint: credentialHint('lwp_secret-token-value'),
        reference: null,
        state: 'active',
        readOnlyUntil: null,
        readOnlyReason: null,
        health: { state: 'unknown', checkedAt: null, latencyMs: null, version: null, clusterId: null, error: null },
        createdBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as FleetClusterEntity,
      NO_ACCESS,
    );

    expect(JSON.stringify(dto)).not.toContain('secret-token');
    expect(dto.credentialHint).toBe('…alue');
  });

  it('registers after a successful connection test (normalised endpoint, version from the header)', async () => {
    const { service, saved, audit } = setup(async () => ({
      data: { clusterId: 'cl-1', nodes: { total: 3, connected: 3 } },
      headers: { 'x-loadweaver-version': '1.4.0' },
    }));

    await service.create(caller, {
      name: 'eu',
      endpoint: 'https://EU.example.com/api',
      credential: 'lwp_0123456789abcdef',
    });

    expect(saved[0]).toMatchObject({
      endpoint: 'https://eu.example.com',
      credentialHint: '…cdef',
      health: { state: 'healthy', version: '1.4.0', clusterId: 'cl-1' },
    });
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain('0123456789abcdef');
  });

  it('refuses registration when the cluster rejects the credential', async () => {
    const { service, saved } = setup(async () => {
      throw new FleetClusterError('Unauthorized', 401);
    });

    await expect(
      service.create(caller, { name: 'eu', endpoint: 'https://eu.example.com', credential: 'lwp_0123456789abcdef' }),
    ).rejects.toThrow('connection test failed');
    expect(saved).toHaveLength(0);
  });

  it('maps probe results to health states', async () => {
    const conn = {
      id: 'x',
      endpoint: 'https://eu.example.com',
      caCertificate: null,
      credential: 'p',
      updatedAt: new Date(),
    };

    expect(
      (await setup(async () => ({ data: { nodes: { total: 3, connected: 2 } }, headers: {} })).service.probe(conn))
        .state,
    ).toBe('degraded');
    expect(
      (
        await setup(async () => {
          throw new FleetClusterError('cluster unreachable: ECONNREFUSED', null);
        }).service.probe(conn)
      ).state,
    ).toBe('unreachable');
    expect(
      (
        await setup(async () => {
          throw new FleetClusterError('Forbidden', 403);
        }).service.probe(conn)
      ).state,
    ).toBe('credential-rejected');
  });

  it('keeps the cluster’s database state and reports it as availability (3.43, 2026-10-31)', async () => {
    const conn = {
      id: 'x',
      endpoint: 'https://eu.example.com',
      caCertificate: null,
      credential: 'p',
      updatedAt: new Date(),
    };
    const health = await setup(async () => ({
      data: { clusterId: 'cl-1', controlPlane: { database: { readOnly: true, freeze: null, location: 'external' } } },
      headers: {},
    })).service.probe(conn);

    expect(health.database).toEqual({
      readOnly: true,
      reason: expect.stringContaining('read-only'),
      freeze: null,
      takenOverAt: null,
    });
    expect(
      toClusterDto({ id: 'c1', createdAt: new Date(), updatedAt: new Date(), health } as never, NO_ACCESS).availability,
    ).toMatchObject({ state: 'read-only' });
  });

  describe('changing the endpoint or CA (L1)', () => {
    const stored = () => ({
      id: 'c1',
      name: 'eu',
      description: null,
      endpoint: 'https://eu.example.com',
      caCertificate: null,
      credential: 'lwp_stored-credential-value',
      credentialHint: '…alue',
      health: { state: 'healthy' },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const CA = '-----BEGIN CERTIFICATE-----\nMIIBszCCAVmgAwIBAgIUQ==\n-----END CERTIFICATE-----';

    function withStored() {
      const ctx = setup(async () => ({ data: {}, headers: {} }));
      const events = { accessChanged: jest.fn() };

      (ctx.service as unknown as { clusters: { findOne: jest.Mock } }).clusters.findOne.mockResolvedValue(stored());
      (ctx.service as unknown as { accessEvents: unknown }).accessEvents = events;

      return { ...ctx, events };
    }

    it('refuses a new endpoint or CA without the credential and never probes with the stored one', async () => {
      const { service, client } = withStored();

      await expect(service.update(caller, 'c1', { endpoint: 'https://attacker.example.net' })).rejects.toThrow(
        'requires re-entering the service credential',
      );
      await expect(service.update(caller, 'c1', { caCertificate: CA })).rejects.toThrow(
        'requires re-entering the service credential',
      );
      expect(client.json).not.toHaveBeenCalled();
    });

    it('probes the new endpoint with the credential given in the same request', async () => {
      const { service, client, events } = withStored();

      await service.update(caller, 'c1', {
        endpoint: 'https://eu2.example.com',
        credential: 'lwp_new-credential-value',
      });
      expect(client.json).toHaveBeenCalledWith(
        expect.objectContaining({ endpoint: 'https://eu2.example.com', credential: 'lwp_new-credential-value' }),
        { method: 'GET', path: 'cluster' },
      );
      expect(events.accessChanged).toHaveBeenCalledWith('c1');
    });

    it('needs no credential when the endpoint does not actually change', async () => {
      const { service } = withStored();

      await expect(
        service.update(caller, 'c1', { endpoint: 'https://EU.example.com/api', description: 'x' }),
      ).resolves.toMatchObject({ endpoint: 'https://eu.example.com', description: 'x' });
    });
  });
});

describe('approvals through the fleet: identity probe (3.24)', () => {
  const connection = {
    id: 'c1',
    endpoint: 'https://eu.example.com',
    caCertificate: null,
    credential: 'x',
    updatedAt: new Date(),
  };

  function probeWith(identityAnswer: () => Promise<unknown>) {
    const client = {
      json: jest.fn(async (_c: unknown, req: { path: string; identity?: string }) =>
        req.path === 'cluster' ? { data: { clusterId: 'uid-1' }, headers: {} } : await identityAnswer(),
      ),
    };
    const identity = { probeClaim: jest.fn(async () => 'probe.claim') };
    const service = new FleetClustersService(
      {} as never,
      {} as never,
      {} as never,
      client as never,
      { record: jest.fn() } as never,
      undefined,
      identity as never,
    );

    return { service, client, identity };
  }

  it('reports verified / untrusted / unsupported from GET /api/fleet-identity with the probe claim', async () => {
    const verified = probeWith(async () => ({ data: { version: 1, verified: true }, headers: {} }));

    await expect(verified.service.probe(connection as never)).resolves.toMatchObject({
      clusterId: 'uid-1',
      identity: 'verified',
    });
    expect(verified.identity.probeClaim).toHaveBeenCalledWith('uid-1');
    expect(verified.client.json).toHaveBeenCalledWith(
      connection,
      expect.objectContaining({ path: 'fleet-identity', identity: 'probe.claim' }),
    );

    await expect(
      probeWith(async () => ({
        data: { verified: false, reason: 'fleet x is not trusted' },
        headers: {},
      })).service.probe(connection as never),
    ).resolves.toMatchObject({ identity: 'untrusted', identityReason: 'fleet x is not trusted' });
    await expect(
      probeWith(async () => {
        throw new FleetClusterError('Cannot GET', 404);
      }).service.probe(connection as never),
    ).resolves.toMatchObject({ state: 'healthy', identity: 'unsupported' });
  });
});

describe('automatic trust in the health poll (2026-10-29)', () => {
  const row = (health: Record<string, unknown>) => ({
    id: 'c1',
    name: 'eu',
    endpoint: 'https://eu.example.com',
    caCertificate: null,
    credential: 'lwp_x',
    credentialHint: '…x',
    state: 'active',
    health,
    updatedAt: new Date(),
  });

  function pollWith(previous: Record<string, unknown>, identityAnswer: Record<string, unknown>) {
    const updates: Record<string, unknown>[] = [];
    const clusters = {
      findOne: jest.fn(async () => row(previous)),
      update: jest.fn(async (_w: unknown, patch: Record<string, unknown>) => updates.push(patch)),
    };
    const client = {
      json: jest.fn(async (_c: unknown, req: { path: string }) =>
        req.path === 'cluster' ? { data: { clusterId: 'uid-1' }, headers: {} } : { data: identityAnswer, headers: {} },
      ),
    };
    const trust = {
      keyIds: jest.fn(async () => ['k1']),
      establish: jest.fn(async (cluster: { health: Record<string, unknown> }) => ({
        attempt: { state: 'established' },
        health: { ...cluster.health, identity: 'verified' },
      })),
    };
    const audit = { record: jest.fn(), recordQuietly: jest.fn() };
    const service = new FleetClustersService(
      clusters as never,
      {} as never,
      {} as never,
      client as never,
      audit as never,
      undefined,
      { probeClaim: jest.fn(async () => 'probe') } as never,
      trust as never,
    );

    return { service, trust, updates, audit };
  }

  it('establishes trust automatically (as the system) when the verified connection isn’t trusted yet', async () => {
    const { service, trust, updates } = pollWith(
      { state: 'healthy', clusterId: 'uid-1' },
      { verified: false, reason: 'fleet f is not trusted by this cluster' },
    );

    await expect(service.poll('c1')).resolves.toMatchObject({ identity: 'verified' });
    expect(trust.establish).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1' }), null);
    // The pinned cluster id is kept from the first sight.
    expect(updates[0]).toMatchObject({ health: expect.objectContaining({ pinnedClusterId: 'uid-1' }) });
  });

  it('marks a removal by the cluster’s admin as revoked and doesn’t re-register', async () => {
    const { service, trust, audit } = pollWith(
      { state: 'healthy', clusterId: 'uid-1', identity: 'verified' },
      { verified: false, reason: 'fleet f is not trusted by this cluster' },
    );

    await expect(service.poll('c1')).resolves.toMatchObject({ trust: expect.objectContaining({ state: 'revoked' }) });
    expect(trust.establish).not.toHaveBeenCalled();
    expect(audit.recordQuietly).toHaveBeenCalledWith(
      null,
      'identity.trust-revoked',
      'cluster/c1/trust',
      expect.anything(),
      'c1',
    );
  });

  it('does nothing when the cluster trusts every key', async () => {
    const { service, trust } = pollWith(
      { state: 'healthy', clusterId: 'uid-1', identity: 'verified' },
      { verified: true, trustedKeys: ['k1'], trustedSince: '2026-10-29T08:00:00.000Z' },
    );

    await expect(service.poll('c1')).resolves.toMatchObject({
      identity: 'verified',
      identitySince: '2026-10-29T08:00:00.000Z',
      // When the cluster answered the probe (2026-10-29): the console compares it with the last trust attempt.
      identityCheckedAt: expect.any(String),
    });
    expect(trust.establish).not.toHaveBeenCalled();
  });
});
