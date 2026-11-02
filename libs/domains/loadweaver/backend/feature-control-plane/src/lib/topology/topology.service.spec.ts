import type { DataSource } from 'typeorm';

import type { ProjectAccessService } from '../access/project-access.service';
import type { NetworkStateService } from '../services/network-state.service';
import { TopologyService } from './topology.service';

describe('TopologyService structure cache', () => {
  function setup() {
    let revision = 7;
    let placements = 6;
    const dataSource = {
      query: jest.fn(async (sql: string) =>
        sql.includes('desired_revision') ? [{ revision, placements: `${placements}/2026-10-20 12:00:00` }] : [],
      ),
    } as unknown as DataSource;
    const service = new TopologyService(dataSource, {} as ProjectAccessService, {} as NetworkStateService);
    const load = jest
      .spyOn(service as unknown as { load: () => Promise<unknown> }, 'load')
      .mockImplementation(async () => ({
        graph: { elements: [], edges: [] },
        sets: new Map(),
        elementOfAddress: new Map(),
      }));
    const structure = () => (service as unknown as { structure: () => Promise<unknown> }).structure();

    return { structure, load, bump: () => revision++, removePlacement: () => placements-- };
  }

  it('shares the structure within the TTL while the compiled revision is unchanged', async () => {
    const { structure, load } = setup();

    await structure();
    await structure();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('reloads at once after a new compiled revision (e.g. replicas start draining)', async () => {
    const { structure, load, bump } = setup();

    await structure();
    bump();
    await structure();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('reloads at once after a placement change without a new revision', async () => {
    const { structure, load, removePlacement } = setup();

    await structure();
    removePlacement();
    await structure();
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe('TopologyService proposed overlay (3.36 B2)', () => {
  it('overlays a dry-run plan’s changes (no stored plan) incl. proposed policy edges and DNS hostnames', async () => {
    const dataSource = {
      query: jest.fn(async (sql: string) =>
        sql.includes('desired_revision')
          ? [{ revision: 1, placements: '1/x' }]
          : sql.includes('DnsZone')
            ? [{ name: 'ex', zone: 'example.com' }]
            : [],
      ),
      getRepository: () => ({ findOne: jest.fn() }),
    } as unknown as DataSource;
    const access = {
      caller: async () => ({ isApiKey: false, clusterRole: 'cluster-admin', projects: new Map() }),
    } as unknown as ProjectAccessService;
    const service = new TopologyService(dataSource, access, {} as NetworkStateService);

    jest.spyOn(service as unknown as { load: () => Promise<unknown> }, 'load').mockImplementation(async () => ({
      graph: {
        elements: [
          { id: 'replica:shop/lw-vm/vm1/0', kind: 'replica', label: 'vm1/0', project: 'shop', data: {} },
          { id: 'hostname:www.example.com', kind: 'hostname', label: 'www.example.com', data: {} },
        ],
        edges: [],
      },
      sets: new Map(),
      elementOfAddress: new Map(),
      input: { nodes: [], workloads: [], workloadGroups: [], policies: [], services: [], nodeGroups: [], network: {} },
    }));

    const result = await service.topology(undefined, {}, [
      {
        action: 'update',
        kind: 'VirtualMachine',
        name: 'vm1',
        project: 'shop',
        baseGeneration: 1,
        before: null,
        after: null,
      },
      {
        action: 'create',
        kind: 'DnsRecord',
        name: 'www',
        project: null,
        baseGeneration: 0,
        before: null,
        after: { spec: { zone: 'ex', name: 'www', type: 'A', values: ['192.0.2.1'] } },
      },
      {
        action: 'create',
        kind: 'Policy',
        name: 'out',
        project: 'shop',
        baseGeneration: 0,
        before: null,
        after: {
          spec: {
            mode: 'enforce',
            action: 'allow',
            from: [{ group: 'web' }],
            to: [{ group: 'db' }],
            rules: [{ protocol: 'tcp', ports: [5432] }],
          },
        },
      },
    ]);

    expect(result.overlay).toMatchObject({
      'replica:shop/lw-vm/vm1/0': 'update',
      'hostname:www.example.com': 'create',
      'policy:shop/out:group:shop/web->group:shop/db': 'create',
    });
    expect(result.edges).toContainEqual(
      expect.objectContaining({
        id: 'policy:shop/out:group:shop/web->group:shop/db',
        data: expect.objectContaining({ proposed: true }),
      }),
    );
  });
});
