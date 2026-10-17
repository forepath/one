import type { DesiredState, NodeNetworkConfig } from '@forepath/loadweaver/shared/util-agent-protocol';

/** A small but complete compiled network config for node n1 (peer n2), used across agent tests. */
export function networkConfig(overrides: Partial<NodeNetworkConfig> = {}): NodeNetworkConfig {
  return {
    node: 'n1',
    addresses: ['10.93.0.1', 'fd00:93::1'],
    wireguard: [
      {
        interface: 'lw-0a1b2c3d',
        listenPort: 51820,
        peer: 'n2',
        peerPublicKey: 'xTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg=',
        peerEndpoint: 'n2.example.test:51821',
        allowedIps: ['10.88.1.10/32', '10.93.0.2/32', 'fd00:93::2/128'],
        addresses: ['10.93.0.1/32', 'fd00:93::1/128'],
        peerAddresses: ['10.93.0.2', 'fd00:93::2'],
        reasons: ['shop/web-to-api'],
      },
    ],
    services: [{ name: 'api.shop.lw', serviceIp: '10.92.0.10', backends: ['10.88.1.10'] }],
    bgp: {
      asn: 4200000000,
      routerId: '10.93.0.1',
      routeReflector: false,
      originate: ['10.88.0.0/24', '10.93.0.1/32', 'fd00:42::/80', 'fd00:93::1/128'],
      sessions: [
        {
          peer: 'n2',
          interface: 'lw-0a1b2c3d',
          peerAddress: 'fd00:93::2',
          peerAddresses: ['10.93.0.2', 'fd00:93::2'],
          role: 'peer',
          exports: ['10.88.0.0/24', '10.93.0.1/32', 'fd00:93::1/128'],
          imports: ['10.88.1.0/24', '10.93.0.2/32', 'fd00:93::2/128'],
        },
      ],
    },
    firewall: {
      sets: {
        lw_00000001: ['10.88.0.10/32', 'fd00:42::10/128'],
        lw_00000002: ['10.88.1.10/32'],
        lw_00000003: ['0.0.0.0/0', '::/0'],
      },
      rules: [
        {
          id: 'shop/web-to-api#1',
          policy: 'shop/web-to-api',
          chain: 'forward',
          srcSet: 'lw_00000001',
          dstSet: 'lw_00000002',
          protocol: 'tcp',
          ports: ['8080'],
          action: 'accept',
        },
        {
          id: 'shop/expose#2',
          policy: 'shop/expose',
          chain: 'forward',
          srcSet: 'lw_00000003',
          dstSet: 'lw_00000001',
          protocol: 'tcp',
          ports: ['443', '8000-8100'],
          action: 'observe',
        },
        {
          id: 'builtin:agent-api#3',
          policy: 'builtin:agent-api',
          chain: 'input',
          srcSet: 'lw_00000002',
          dstSet: 'lw_00000001',
          protocol: 'icmp',
          ports: [],
          action: 'accept',
        },
      ],
    },
    dns: {
      domain: 'lw',
      records: [{ name: 'api.shop.lw', addresses: ['10.92.0.10', 'fd00:92::10'] }],
      visibility: { '10.88.0.10': ['api.shop.lw'] },
    },
    ...overrides,
  };
}

export function desiredState(revision = 1, overrides: Partial<DesiredState> = {}): DesiredState {
  return {
    revision,
    network: networkConfig(),
    controlPlane: { role: 'none', members: [], automaticFailover: false, scope: 'c1' },
    workloads: [],
    volumes: [],
    lifecycle: 'active',
    ...overrides,
  };
}
