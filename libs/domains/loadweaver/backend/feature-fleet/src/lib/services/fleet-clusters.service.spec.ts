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
