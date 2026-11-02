import { clusterNetworkSchema, type PolicySpecInput, policySpecSchema } from '@forepath/loadweaver/shared/util-model';

import { compileNetwork } from './compile';
import type { CompilerInput, CompilerNode, CompilerWorkload, NamedPolicy } from './types';

/**
 * Draining replicas (M6 gate: two-phase removal): a removed replica first leaves routing — no backend of its
 * service IPs, no mesh endpoint — while its policies stay (open connections continue); it stops later.
 */
const network = clusterNetworkSchema.parse({
  podPoolV4: '10.42.0.0/16',
  servicePoolV4: '10.43.0.0/16',
  overlayPoolV4: '10.44.0.0/16',
});

function node(name: string, index: number): CompilerNode {
  return {
    name,
    site: 'fra1',
    labels: {},
    controlPlane: false,
    witness: false,
    overlayV4: `10.44.0.${index}`,
    podSubnetV4: `10.42.${index}.0/24`,
    endpointHost: `203.0.113.${index}`,
    wireguardPublicKey: `key-${name}`,
  };
}

function workload(id: string, nodeName: string, nodeIndex: number, host: number, draining = false): CompilerWorkload {
  const [project, service] = id.split('/');

  return {
    id,
    project,
    deployment: project,
    service,
    node: nodeName,
    labels: { app: service },
    addresses: [`10.42.${nodeIndex}.${host}`],
    ...(draining ? { draining: true } : {}),
  };
}

function policy(name: string, spec: PolicySpecInput): NamedPolicy {
  return { name, project: 'shop', spec: policySpecSchema.parse(spec) };
}

function input(protocol: 'udp' | 'tcp', apiDraining: boolean): CompilerInput {
  return {
    network,
    nodes: [node('n1', 1), node('n2', 2), node('n3', 3)],
    workloads: [
      workload('shop/web/0', 'n1', 1, 10),
      workload('shop/api/0', 'n2', 2, 10),
      // The replica being removed (scale-down 2 → 1).
      workload('shop/api/1', 'n3', 3, 10, apiDraining),
    ],
    services: [{ project: 'shop', deployment: 'shop', name: 'api', serviceIps: ['10.43.0.10'] }],
    nodeGroups: [],
    workloadGroups: ['web', 'api'].map((app) => ({
      project: 'shop',
      name: app,
      spec: { selector: { matchLabels: { app } }, intraGroup: 'allow' as const, exposed: false },
    })),
    policies: [
      policy('web-to-api', { from: [{ group: 'web' }], to: [{ group: 'api' }], rules: [{ protocol, ports: [8080] }] }),
    ],
  };
}

describe('draining replicas', () => {
  it('are no backend of their service IP any more, but keep their policies', () => {
    const before = compileNetwork(input('udp', false));
    const after = compileNetwork(input('udp', true));

    expect(before.nodes['n1'].services).toEqual([
      { name: 'api.shop.shop.lw', serviceIp: '10.43.0.10', backends: ['10.42.2.10', '10.42.3.10'] },
    ]);
    expect(after.nodes['n1'].services).toEqual([
      { name: 'api.shop.shop.lw', serviceIp: '10.43.0.10', backends: ['10.42.2.10'] },
    ]);
    // Open connections to the draining replica keep working: its allow rules are still there.
    expect(after.nodes['n3'].firewall.rules.some((r) => r.policy === 'shop/web-to-api')).toBe(true);
    expect(after.nodes['n1'].wireguard.map((l) => l.peer)).toContain('n3');
  });

  it('are no mesh endpoint (upstream node, inbound backend) any more', () => {
    const before = compileNetwork(input('tcp', false));
    const after = compileNetwork(input('tcp', true));

    expect(before.nodes['n1'].mesh?.upstreams[0].endpoints).toEqual(['10.44.0.2', '10.44.0.3']);
    expect(after.nodes['n1'].mesh?.upstreams[0].endpoints).toEqual(['10.44.0.2']);
    expect(before.nodes['n3'].mesh?.inbound[0].backends).toEqual(['10.42.3.10']);
    expect(after.nodes['n3'].mesh?.inbound[0]?.backends ?? []).toEqual([]);
    expect(after.nodes['n2'].mesh?.inbound[0].backends).toEqual(['10.42.2.10']);
  });
});
