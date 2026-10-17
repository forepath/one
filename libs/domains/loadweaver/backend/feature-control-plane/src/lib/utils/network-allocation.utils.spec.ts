import { clusterNetworkSchema } from '@forepath/loadweaver/shared/util-model';
import { isCidr } from '@forepath/loadweaver/shared/util-network';

import { allocateNodeAddressing, defaultClusterNetwork } from './network-allocation.utils';

describe('network allocation', () => {
  const network = clusterNetworkSchema.parse(
    defaultClusterNetwork(() => new Uint8Array([0xab, 0xcd, 0xef, 0x12, 0x34])),
  );

  it('produces valid default dual-stack pools', () => {
    expect(network.podPoolV6).toBe('fdab:cdef:1234::/56');
    expect(isCidr(network.servicePoolV6!)).toBe(true);
    expect(isCidr(network.overlayPoolV6!)).toBe(true);
  });

  it('allocates the next free overlay addresses and subnets', () => {
    const first = allocateNodeAddressing(network, []);
    const second = allocateNodeAddressing(network, [first]);

    expect(first).toEqual({
      overlayV4: '10.93.0.1',
      overlayV6: 'fdab:cdef:1234:200::1',
      podSubnetV4: '10.88.0.0/24',
      podSubnetV6: 'fdab:cdef:1234::/80',
    });
    expect(second).toEqual({
      overlayV4: '10.93.0.2',
      overlayV6: 'fdab:cdef:1234:200::2',
      podSubnetV4: '10.88.1.0/24',
      podSubnetV6: 'fdab:cdef:1234:0:1::/80',
    });
  });

  it('supports single-stack clusters and reports exhaustion', () => {
    const v6only = clusterNetworkSchema.parse({
      podPoolV6: 'fd00::/120',
      servicePoolV6: 'fd01::/120',
      overlayPoolV6: 'fd02::/127',
      nodePrefixV6: 120,
    });
    const a = allocateNodeAddressing(v6only, []);

    expect(a).toEqual({ overlayV4: null, overlayV6: 'fd02::1', podSubnetV4: null, podSubnetV6: 'fd00::/120' });
    expect(() => allocateNodeAddressing(v6only, [a])).toThrow('exhausted');
  });
});
