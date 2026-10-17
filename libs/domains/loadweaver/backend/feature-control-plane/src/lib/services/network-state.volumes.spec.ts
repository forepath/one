import { NodeEntity } from '../entities/node.entity';
import { VolumePlacementEntity } from '../entities/volume-placement.entity';
import { nodeVolumes } from './network-state.service';

const node = (name: string, site: string, overlayV4: string) =>
  Object.assign(new NodeEntity(), { name, site, overlayV4, overlayV6: null });

describe('nodeVolumes', () => {
  const nodes = [
    node('a1', 'fra1', '10.93.0.1'),
    node('a2', 'fra1', '10.93.0.2'),
    node('b1', 'ams1', '10.93.0.3'),
    node('c1', 'par1', '10.93.0.4'),
  ];
  const placement = Object.assign(new VolumePlacementEntity(), {
    id: 'shop/store/data',
    primaryNode: 'a1',
    syncReplicas: ['a2'],
    remoteReplicas: ['b1'],
    sizeBytes: '1073741824',
    crossSite: 'async' as const,
    drbdMinor: 1000,
    drbdPort: 7800,
  });

  it('assigns the volume to every replica holder with node ids and per-site protocols', () => {
    const [assignment] = nodeVolumes('a2', [placement], nodes);

    expect(assignment).toEqual({
      id: 'shop/store/data',
      dockerName: 'lw-vol-shop.store.data',
      minor: 1000,
      port: 7800,
      sizeBytes: 1073741824,
      replicas: [
        { node: 'a1', nodeId: 0, address: '10.93.0.1' },
        { node: 'a2', nodeId: 1, address: '10.93.0.2' },
        { node: 'b1', nodeId: 2, address: '10.93.0.3' },
      ],
      connections: [
        { a: 'a1', b: 'a2', protocol: 'C' },
        { a: 'a1', b: 'b1', protocol: 'A' },
        { a: 'a2', b: 'b1', protocol: 'A' },
      ],
      primary: 'a1',
      keyRef: 'secret://shop/lw-volume-store.data',
    });
  });

  it('uses synchronous replication across sites when asked and skips nodes without a copy', () => {
    expect(
      nodeVolumes('b1', [{ ...placement, crossSite: 'sync' } as VolumePlacementEntity], nodes)[0].connections.every(
        (c) => c.protocol === 'C',
      ),
    ).toBe(true);
    expect(nodeVolumes('c1', [placement], nodes)).toEqual([]);
  });

  it('keeps DRBD node ids stable across failovers and names hosts by their reported host names', () => {
    const named = nodes.map((n) =>
      Object.assign(new NodeEntity(), { ...n, hostname: n.name === 'b1' ? null : `${n.name}.lan` }),
    );
    const failedOver = Object.assign(new VolumePlacementEntity(), {
      ...placement,
      primaryNode: 'a2',
      syncReplicas: ['a1'],
      drbdNodeIds: { a1: 0, a2: 1, b1: 2 },
      drbdNextNodeId: 3,
    });

    expect(nodeVolumes('a1', [failedOver], named)[0].replicas).toEqual([
      { node: 'a2', nodeId: 1, address: '10.93.0.2', host: 'a2.lan' },
      { node: 'a1', nodeId: 0, address: '10.93.0.1', host: 'a1.lan' },
      { node: 'b1', nodeId: 2, address: '10.93.0.3' },
    ]);

    // A replica moved from b1 to c1 that no plan persisted ids for yet still gets a free id, not b1's.
    const moved = Object.assign(new VolumePlacementEntity(), { ...failedOver, remoteReplicas: ['c1'] });

    expect(nodeVolumes('c1', [moved], named)[0].replicas.map((r) => [r.node, r.nodeId])).toEqual([
      ['a2', 1],
      ['a1', 0],
      ['c1', 3],
    ]);
  });
});
