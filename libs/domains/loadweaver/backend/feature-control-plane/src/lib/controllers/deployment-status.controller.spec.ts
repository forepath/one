import { NotFoundException } from '@nestjs/common';
import type { DataSource } from 'typeorm';

import { appAnnotations } from '@forepath/loadweaver/shared/util-model';

import type { ProjectAccessService } from '../access/project-access.service';
import { AppTakedownFlagEntity } from '../app-store/app-store.entities';
import { NodeEntity } from '../entities/node.entity';
import { ResourceEntity } from '../entities/resource.entity';
import { ServiceAddressEntity } from '../entities/service-address.entity';
import { WorkloadPlacementEntity } from '../entities/workload-placement.entity';
import { DeploymentStatusController, nodeWaitReasons, replicaStatus } from './deployment-status.controller';

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

  it('shows "waiting for a node" while the replica\'s node can not run workloads (user decision 2026-11-01)', async () => {
    const now = Date.parse('2026-11-01T10:00:00Z');
    const node = (name: string, extra: Partial<NodeEntity>) =>
      Object.assign(new NodeEntity(), { name, lifecycle: 'active', lastSeenAt: new Date(now), ...extra });
    const reasons = nodeWaitReasons(
      [
        node('n1', { lastSeenAt: new Date(0) }),
        node('n2', {}),
        node('n3', { lifecycle: 'cordoned' }),
        node('n4', { lifecycle: 'left' }),
      ],
      now,
    );

    expect([...reasons]).toEqual([
      ['n1', 'node n1 is unreachable'],
      ['n3', 'node n3 is cordoned'],
      ['n4', 'node n4 left the cluster'],
    ]);
    expect(replicaStatus(placement('shop/web/app/0', { status: null }), reasons.get('n1'))).toMatchObject({
      state: 'pending',
      message: 'waiting for a node (node n1 is unreachable)',
    });
    expect(replicaStatus(placement('shop/web/app/0'), reasons.get('n2')).message).toBeUndefined();

    const rows = new Map<unknown, unknown[]>([
      [WorkloadPlacementEntity, [placement('shop/web/app/0', { status: null })]],
      [NodeEntity, [node('n1', { lastSeenAt: new Date(0) })]],
    ]);
    const controller = new DeploymentStatusController(
      { getRepository: (entity: unknown) => ({ find: async () => rows.get(entity) ?? [] }) } as unknown as DataSource,
      { assertRead: jest.fn(async () => undefined) } as unknown as ProjectAccessService,
    );

    expect((await controller.status('shop', 'web')).replicas[0]).toMatchObject({
      state: 'pending',
      message: 'waiting for a node (node n1 is unreachable)',
    });
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

    expect(status.app).toBeUndefined();

    rows.clear();
    await expect(controller.status('shop', 'gone')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('flags an installed app hit by a takedown (P1 app store)', async () => {
    const app = {
      catalog: 'official',
      name: 'wiki',
      version: '1.2.0',
      channel: 'stable',
      digest: `sha256:${'a'.repeat(64)}`,
    };
    const rows = new Map<unknown, unknown[]>([
      [WorkloadPlacementEntity, [placement('shop/web/app/0')]],
      [ResourceEntity, [{ kind: 'Deployment', name: 'web', project: 'shop', annotations: appAnnotations(app) }]],
      [
        AppTakedownFlagEntity,
        [
          {
            project: 'shop',
            deployment: 'web',
            version: '1.2.0',
            reason: 'malware',
            takenDownAt: new Date('2026-10-30T00:00:00Z'),
          },
        ],
      ],
    ]);
    const dataSource = { getRepository: (entity: unknown) => ({ find: async () => rows.get(entity) ?? [] }) };
    const controller = new DeploymentStatusController(
      dataSource as unknown as DataSource,
      { assertRead: jest.fn(async () => undefined) } as unknown as ProjectAccessService,
    );

    expect((await controller.status('shop', 'web')).app).toEqual({
      ...app,
      takedown: { reason: 'malware', at: '2026-10-30T00:00:00.000Z' },
    });
  });
});
