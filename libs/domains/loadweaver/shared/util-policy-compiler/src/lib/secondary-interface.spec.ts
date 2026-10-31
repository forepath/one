import { clusterNetworkSchema, policySpecSchema } from '@forepath/loadweaver/shared/util-model';

import { compileNetwork } from './compile';
import type { CompilerInput, CompilerNode, CompilerWorkload } from './types';

/**
 * Full VMs with several NICs (3.35): every NIC is a policy member of its own (own addresses, labels, groups); the
 * extra NICs are no backends of the VM's service IP.
 */
const network = clusterNetworkSchema.parse({
  podPoolV4: '10.42.0.0/16',
  servicePoolV4: '10.43.0.0/16',
  overlayPoolV4: '10.44.0.0/16',
});

const node = (name: string, index: number): CompilerNode => ({
  name,
  site: 'fra1',
  labels: {},
  controlPlane: false,
  witness: false,
  overlayV4: `10.44.0.${index}`,
  podSubnetV4: `10.42.${index}.0/24`,
  endpointHost: `203.0.113.${index}`,
  wireguardPublicKey: `key-${name}`,
});

const vmNic = (id: string, address: string, groups: string[], secondary: boolean): CompilerWorkload => ({
  id,
  project: 'shop',
  deployment: 'lw-vm',
  service: 'db1',
  node: 'n2',
  labels: { 'loadweaver.com/vm': 'db1' },
  addresses: [address],
  groups,
  ...(secondary ? { secondaryInterface: true } : {}),
});

const input: CompilerInput = {
  network,
  nodes: [node('n1', 1), node('n2', 2)],
  workloads: [
    {
      id: 'shop/store/web/0',
      project: 'shop',
      deployment: 'store',
      service: 'web',
      node: 'n1',
      labels: {},
      addresses: ['10.42.1.10'],
      groups: ['web'],
    },
    {
      id: 'shop/store/ops/0',
      project: 'shop',
      deployment: 'store',
      service: 'ops',
      node: 'n1',
      labels: {},
      addresses: ['10.42.1.11'],
      groups: ['admin-clients'],
    },
    vmNic('shop/lw-vm/db1/0', '10.42.2.10', ['db'], false),
    vmNic('shop/lw-vm/db1/0#mgmt', '10.42.2.11', ['admin'], true),
  ],
  services: [{ project: 'shop', deployment: 'lw-vm', name: 'db1', serviceIps: ['10.43.0.10'] }],
  nodeGroups: [],
  workloadGroups: ['web', 'db', 'admin', 'admin-clients'].map((name) => ({
    project: 'shop',
    name,
    spec: { selector: { names: [] }, intraGroup: 'allow' as const, exposed: false },
  })),
  policies: [
    {
      name: 'web-db',
      project: 'shop',
      spec: policySpecSchema.parse({
        from: [{ group: 'web' }],
        to: [{ group: 'db' }],
        rules: [{ protocol: 'udp', ports: [5432] }],
      }),
    },
    {
      name: 'ops-mgmt',
      project: 'shop',
      spec: policySpecSchema.parse({
        from: [{ group: 'admin-clients' }],
        to: [{ group: 'admin' }],
        rules: [{ protocol: 'udp', ports: [22] }],
      }),
    },
  ],
};

describe('VM NICs as policy members', () => {
  const result = compileNetwork(input);

  it('backs the VM service IP with the primary NIC only', () => {
    expect(result.nodes['n1'].services).toEqual([
      { name: 'db1.lw-vm.shop.lw', serviceIp: '10.43.0.10', backends: ['10.42.2.10'] },
    ]);
  });

  it('gives each NIC its own policies', () => {
    const rules = JSON.stringify(result.nodes['n2'].firewall);

    expect(rules).toContain('10.42.2.11');
    expect(rules).toContain('10.42.2.10');
    expect(rules).toContain('10.42.1.11');
  });
});
