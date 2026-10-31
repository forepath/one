import { NotFoundException } from '@nestjs/common';
import type { DataSource } from 'typeorm';

import type { ProjectAccessService } from '../access/project-access.service';
import { ServiceAddressEntity } from '../entities/service-address.entity';
import { WorkloadPlacementEntity } from '../entities/workload-placement.entity';
import { DeploymentStatusController, replicaStatus } from './deployment-status.controller';

const placement = (id: string, extra: Partial<WorkloadPlacementEntity> = {}) =>
  ({
    id,
    project: 'shop',
    deployment: 'web',
    service: id.split('/')[2],
    node: 'n1',
    addresses: ['10.1.0.2'],
    status: { n1: { state: 'running', specHash: 'h', at: '2026-10-20T00:00:00Z' } },
    drainUntil: null,
    ...extra,
  }) as WorkloadPlacementEntity;

describe('deployment status (M6 gate: draining replicas)', () => {
  it('reports the node state for a running replica', () => {
    expect(replicaStatus(placement('shop/web/app/0'))).toEqual({
      id: 'shop/web/app/0',
      service: 'app',
      node: 'n1',
      addresses: ['10.1.0.2'],
      state: 'running',
    });
  });

  it('reports a removed replica as draining with its deadline, whatever the node says', () => {
    const until = new Date('2026-10-20T10:00:10Z');

    expect(replicaStatus(placement('shop/web/app/1', { drainUntil: until }))).toMatchObject({
      state: 'draining',
      drainUntil: until.toISOString(),
    });
  });

  it('keeps `pending` before the first report', () => {
    expect(replicaStatus(placement('shop/web/app/0', { status: null })).state).toBe('pending');
  });

  it('lists draining replicas next to the others; 404 for unknown deployments', async () => {
    const rows = new Map<unknown, unknown[]>([
      [
        WorkloadPlacementEntity,
        [placement('shop/web/app/0'), placement('shop/web/app/1', { drainUntil: new Date('2026-10-20T10:00:10Z') })],
      ],
      [ServiceAddressEntity, [{ id: 'shop/web/app', addressV4: '10.96.0.5', addressV6: null }]],
    ]);
    const dataSource = { getRepository: (entity: unknown) => ({ find: async () => rows.get(entity) ?? [] }) };
    const access = { assertRead: jest.fn(async () => undefined) };
    const controller = new DeploymentStatusController(
      dataSource as unknown as DataSource,
      access as unknown as ProjectAccessService,
    );
    const status = await controller.status('shop', 'web');

    expect(status.replicas.map((r) => [r.id, r.state])).toEqual([
      ['shop/web/app/0', 'running'],
      ['shop/web/app/1', 'draining'],
    ]);
    expect(status.services).toEqual([{ name: 'app', addressV4: '10.96.0.5', addressV6: null }]);

    rows.clear();
    await expect(controller.status('shop', 'gone')).rejects.toBeInstanceOf(NotFoundException);
  });
});
