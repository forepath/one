import type { IpPoolSpec } from '@forepath/loadweaver/shared/util-model';

import { nodePublicAddresses, UPLINK_LABEL } from './public-address-state.utils';

const pool = (failover: IpPoolSpec['failover']): IpPoolSpec => ({
  cidrs: ['203.0.113.0/28'],
  nodeGroup: 'ingress',
  failover,
  purposes: ['ingress'],
  bgpMode: 'primary-backup',
  cooldownSeconds: 0,
  ...(failover === 'provider' ? { provider: { type: 'x', credentials: 'secret://p/x' } } : {}),
});
const node = (name: string, labels: Record<string, string> = {}) => ({
  name,
  site: 'fra1',
  labels,
  lifecycle: 'active',
  reachable: true,
});
const nodes = [node('n1', { [UPLINK_LABEL]: 'bond0' }), node('n2'), node('n9')];
const groups = new Map([['ingress', { selector: { names: ['n1', 'n2'] }, intraGroup: 'allow' as const }]]);
const row = (address: string, pool: string, holder: string | null, vrid: number | null = null) => ({
  address,
  pool,
  state: 'assigned' as const,
  holder,
  vrid,
});

describe('nodePublicAddresses', () => {
  const pools = new Map([
    ['vip', pool('vrrp')],
    ['float', pool('provider')],
    ['any', pool('bgp')],
  ]);
  const rows = [row('203.0.113.1', 'vip', 'n2', 4), row('203.0.113.2', 'float', 'n2'), row('203.0.113.3', 'any', 'n1')];

  it('gives VRRP and BGP addresses to every candidate, provider addresses to the holder only', () => {
    expect(nodePublicAddresses(nodes[0], rows, pools, groups, nodes)).toEqual([
      { address: '203.0.113.1', interface: 'bond0', mode: 'vrrp', active: false, vrrp: { vrid: 4, priority: 100 } },
      { address: '203.0.113.3', interface: 'bond0', mode: 'bgp', active: true },
    ]);
    expect(nodePublicAddresses(nodes[1], rows, pools, groups, nodes)).toEqual([
      { address: '203.0.113.1', mode: 'vrrp', active: true, vrrp: { vrid: 4, priority: 200 } },
      { address: '203.0.113.2', mode: 'provider', active: true },
      { address: '203.0.113.3', mode: 'bgp', active: false },
    ]);
    expect(nodePublicAddresses(nodes[2], rows, pools, groups, nodes)).toEqual([]);
  });
});
