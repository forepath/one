import { ForbiddenException } from '@nestjs/common';

import type { ClusterAccessService } from '../services/cluster-access.service';
import { NodesService } from '../services/nodes.service';
import type { PatroniRole } from '../utils/node-platform.utils';
import { NodesController } from './nodes.controller';

describe('NodesController platform (2026-10-30)', () => {
  const rows = [{ id: 'etcd', component: 'etcd', label: 'etcd', role: 'member', state: 'running' }];

  it('answers the node platform components for any cluster reader', async () => {
    const nodes = { platform: jest.fn().mockResolvedValue(rows) };
    const access = { assert: jest.fn().mockResolvedValue(undefined) };
    const controller = new NodesController(nodes as unknown as NodesService, access as unknown as ClusterAccessService);

    await expect(controller.platform('lw-devnode-1')).resolves.toEqual(rows);
    expect(access.assert).toHaveBeenCalledWith(undefined, 'read');
    expect(nodes.platform).toHaveBeenCalledWith('lw-devnode-1');
  });

  it('refuses callers without read access before looking anything up', async () => {
    const nodes = { platform: jest.fn() };
    const access = { assert: jest.fn().mockRejectedValue(new ForbiddenException()) };
    const controller = new NodesController(nodes as unknown as NodesService, access as unknown as ClusterAccessService);

    await expect(controller.platform('lw-devnode-1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(nodes.platform).not.toHaveBeenCalled();
  });
});

describe('NodesService.platform', () => {
  class TestNodesService extends NodesService {
    readonly asked: string[] = [];

    protected override async patroniRole(node: { name: string }): Promise<PatroniRole> {
      this.asked.push(node.name);

      return 'leader';
    }
  }

  const service = (connected: boolean, role: 'member' | 'none') => {
    const node = {
      name: 'n1',
      lifecycle: 'active',
      connected,
      lastSeenAt: new Date(),
      lastReportSteps: [{ layer: 'control-plane', status: 'applied' }],
    };
    const repo = { findByNameOrThrow: jest.fn().mockResolvedValue(node) };
    const network = {
      getDesiredState: jest.fn().mockResolvedValue({
        controlPlane: { role, members: [{ name: 'n1', address: '10.0.0.1', witness: false }], scope: 'c1' },
      }),
    };
    const sessions = { get: jest.fn().mockReturnValue(undefined) };

    return new TestNodesService(
      null as never,
      repo as never,
      null as never,
      null as never,
      network as never,
      null as never,
      null as never,
      sessions as never,
    );
  };

  it('asks Patroni of a connected member for the Postgres role', async () => {
    const nodes = service(true, 'member');
    const rows = await nodes.platform('n1');

    expect(nodes.asked).toEqual(['n1']);
    expect(rows.find((r) => r.component === 'postgres')).toMatchObject({ role: 'leader', state: 'running' });
  });

  it("doesn't ask disconnected nodes or non-members", async () => {
    const offline = service(false, 'member');

    expect((await offline.platform('n1')).find((r) => r.component === 'postgres')).toMatchObject({
      role: 'member',
      state: 'unknown',
    });
    expect(offline.asked).toEqual([]);

    const worker = service(true, 'none');

    expect(await worker.platform('n1')).toEqual([]);
    expect(worker.asked).toEqual([]);
  });
});
