import { composePort, DriftService, serviceName } from './drift.service';

describe('drift proposals (3.8)', () => {
  it('turns Docker port bindings and names into compose', () => {
    expect(composePort('0.0.0.0:8088->80/tcp')).toBe('8088:80/tcp');
    expect(composePort('[::]:53->53/udp')).toBe('53:53/udp');
    expect(composePort('garbage')).toBeNull();
    expect(serviceName('Legacy Web!')).toBe('legacy-web');
    expect(serviceName('///')).toBe('service');
  });
});

describe('drift report: delegated containers (Agenstra on Loadweaver)', () => {
  it('lists containers a Docker-socket workload started as delegated, not as drift', async () => {
    const container = (id: string, extra: Record<string, unknown> = {}) => ({
      id,
      name: id,
      image: 'img',
      state: 'running',
      ports: [],
      ...extra,
    });
    const nodes = [
      {
        name: 'n1',
        drift: {
          at: '2026-10-19T00:00:00.000Z',
          containers: [container('aaaaaaaaaaaa'), container('bbbbbbbbbbbb', { delegatedTo: 'ws/manager/api/0' })],
        },
      },
    ];
    const service = new DriftService(
      {
        getRepository: (entity: { name: string }) => ({
          find: async () => (entity.name === 'NodeEntity' ? nodes : []),
          findOne: async () => nodes[0],
        }),
      } as never,
      { caller: async () => ({ clusterRole: 'cluster-admin' }) } as never,
      {} as never,
      { ahead: async () => [] } as never,
    );

    const report = await service.report(undefined);

    expect(report.containers.map((c) => c.id)).toEqual(['aaaaaaaaaaaa']);
    expect(report.delegated).toEqual([
      expect.objectContaining({ id: 'bbbbbbbbbbbb', node: 'n1', delegatedTo: 'ws/manager/api/0' }),
    ]);
    await expect(
      service.propose(undefined, { node: 'n1', container: 'bbbbbbbbbbbb', project: 'p', deployment: 'd' }),
    ).rejects.toThrow('managed by ws/manager/api/0');
  });
});
