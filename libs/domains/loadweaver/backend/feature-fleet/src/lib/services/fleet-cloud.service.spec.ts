import { NotFoundException } from '@nestjs/common';

import type { FleetCaller } from '../utils/fleet-access.utils';
import { FleetCloudService } from './fleet-cloud.service';

const decabill: FleetCaller = { userId: 'svc', isApiKey: false, isAdmin: true, label: 'fleet:decabill' };
const NOW = new Date('2026-10-20T12:00:00Z');

function setup(state: 'active' | 'teardown' | 'retired' = 'active', readOnlyUntil: Date | null = null) {
  const cluster = {
    id: 'c1',
    name: 'cust-1',
    endpoint: 'https://c1.example.com',
    reference: 'decabill:sub-1:item-1',
    state,
    readOnlyUntil,
    readOnlyReason: null as string | null,
    health: { state: 'healthy' },
    credentialHint: '…abcd',
    caCertificate: null,
    description: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
  const clusters = { save: jest.fn(async (c: unknown) => c) };
  const operations = { findOne: jest.fn(async () => null) };
  const connections = {
    findByReference: jest.fn(async (ref: string) => (ref === cluster.reference ? cluster : null)),
    create: jest.fn(async () => cluster),
    putGrant: jest.fn(),
  };
  const ops = { startFinalBackup: jest.fn(async () => ({ id: 'op-1' })) };
  const audit = { record: jest.fn() };
  const service = new FleetCloudService(
    clusters as never,
    operations as never,
    connections as never,
    ops as never,
    audit as never,
  );

  return { service, cluster, clusters, ops, audit, connections };
}

describe('Loadweaver Cloud hooks (section 4)', () => {
  it('starts the read-only grace and the final backup once', async () => {
    const { service, cluster, ops, audit } = setup();
    const until = '2026-10-27T12:00:00.000Z';

    const result = await service.teardown(decabill, cluster.reference, { readOnlyUntil: until }, NOW);

    expect(cluster).toMatchObject({ state: 'teardown', readOnlyReason: 'Loadweaver Cloud subscription cancelled' });
    expect(cluster.readOnlyUntil?.toISOString()).toBe(until);
    expect(ops.startFinalBackup).toHaveBeenCalledWith(decabill, cluster, NOW);
    expect(audit.record).toHaveBeenCalledWith(
      decabill,
      'cloud.teardown-started',
      'cluster/c1',
      expect.anything(),
      'c1',
    );
    expect(result.cluster).not.toHaveProperty('credential');
  });

  it('is idempotent while the grace runs: no new audit entry, the existing final backup is reused', async () => {
    const until = new Date('2026-10-27T12:00:00Z');
    const { service, cluster, ops, audit, clusters } = setup('teardown', until);

    await service.teardown(decabill, cluster.reference, { readOnlyUntil: until.toISOString() }, NOW);

    expect(clusters.save).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    // `since` = epoch: any final backup of this teardown counts (the operations service returns it).
    expect(ops.startFinalBackup).toHaveBeenCalledWith(decabill, cluster, new Date(0));
  });

  it('skips the backup when asked or when the grace already ended, and leaves retired clusters alone', async () => {
    const a = setup();

    await a.service.teardown(
      decabill,
      a.cluster.reference,
      { readOnlyUntil: '2026-10-27T12:00:00Z', finalBackup: false },
      NOW,
    );
    expect(a.ops.startFinalBackup).not.toHaveBeenCalled();

    const b = setup();

    await b.service.teardown(decabill, b.cluster.reference, { readOnlyUntil: '2026-10-19T12:00:00Z' }, NOW);
    expect(b.ops.startFinalBackup).not.toHaveBeenCalled();

    const c = setup('retired');

    await c.service.teardown(decabill, c.cluster.reference, { readOnlyUntil: '2026-10-27T12:00:00Z' }, NOW);
    expect(c.cluster.state).toBe('retired');
    expect(c.ops.startFinalBackup).not.toHaveBeenCalled();
  });

  it('refuses unknown references and graces beyond 120 days', async () => {
    const { service, cluster } = setup();

    await expect(
      service.teardown(decabill, 'decabill:x:y', { readOnlyUntil: '2026-10-27T12:00:00Z' }, NOW),
    ).rejects.toThrow(NotFoundException);
    await expect(
      service.teardown(decabill, cluster.reference, { readOnlyUntil: '2027-10-27T12:00:00Z' }, NOW),
    ).rejects.toThrow('within 120 days');
  });

  it('gives full access back when the subscription is resumed', async () => {
    const { service, cluster } = setup('teardown', new Date('2026-10-27T12:00:00Z'));

    await service.cancelTeardown(decabill, cluster.reference);
    expect(cluster).toMatchObject({ state: 'active', readOnlyUntil: null });
  });

  it('registers a Decabill cluster with its reference and initial grants', async () => {
    const { service, connections } = setup();
    const dto = {
      name: 'cust-1',
      endpoint: 'https://c1.example.com',
      credential: 'lwp_0123456789abcdef',
      reference: 'decabill:sub-1:item-1',
      grants: [{ userId: '00000000-0000-4000-8000-000000000001', role: 'admin' as const }],
    };

    await service.register(decabill, dto);
    expect(connections.create).toHaveBeenCalledWith(decabill, dto, { reference: 'decabill:sub-1:item-1' });
    expect(connections.putGrant).toHaveBeenCalledWith(decabill, 'c1', dto.grants[0]);
  });
});
