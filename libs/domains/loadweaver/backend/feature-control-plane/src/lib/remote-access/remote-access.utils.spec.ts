import { clientGroupSpecSchema } from '@forepath/loadweaver/shared/util-model';

import type { PostureState, VpnClientEntity } from '../entities/vpn-client.entity';
import {
  allocateClientAddress,
  compareVersions,
  effectiveGroups,
  groupsForRoles,
  hasMfa,
  keyLifetimeMs,
  postureFailures,
  remoteAccessInput,
  remoteAccessIssues,
  renderClientConfig,
  subnetIssues,
} from './remote-access.utils';

const NOW = Date.parse('2026-10-17T12:00:00Z');

const groups = new Map([
  ['sales', clientGroupSpecSchema.parse({ idpGroups: ['sales', 'sales-emea'], keyLifetimeDays: 14 })],
  [
    'finance',
    clientGroupSpecSchema.parse({
      idpGroups: ['finance'],
      requireMfa: true,
      posture: {
        diskEncryption: true,
        minOsVersion: { macos: '14.5' },
        plugins: [{ type: 'crowdstrike', require: 'low-risk' }],
      },
      restrictedGroup: 'helpdesk',
    }),
  ],
  ['helpdesk', clientGroupSpecSchema.parse({ idpGroups: [] })],
]);

function posture(extra: Partial<PostureState> = {}): PostureState {
  return {
    report: { platform: 'macos', osVersion: '14.6.1', diskEncryption: true },
    reportedAt: new Date(NOW - 60_000).toISOString(),
    plugins: { crowdstrike: { verdict: 'low-risk' } },
    failing: {},
    ...extra,
  };
}

function client(extra: Partial<VpnClientEntity> = {}): VpnClientEntity {
  return {
    id: '0b8f7c38-4c55-4a52-9f3e-6a0d1fd4a001',
    kind: 'user',
    name: 'laptop',
    userId: 'u1',
    ownerLabel: 'alice@example.com',
    publicKey: 'HIgo9xNzJMWLKASShiTqIybxZ0U3wGLiUeJ1PKf8ykw=',
    address: '100.96.0.10',
    subnets: [],
    groups: ['finance', 'sales'],
    posture: posture(),
    createdAt: new Date(NOW - 86_400_000),
    renewedAt: new Date(NOW - 86_400_000),
    expiresAt: new Date(NOW + 86_400_000),
    revokedAt: null,
    lastHandshakeAt: null,
    lastEndpoint: null,
    lastGateway: null,
    integrationPosture: {},
    certificateSerial: null,
    certificateNotAfter: null,
    ...extra,
  };
}

describe('remote access utils', () => {
  it('maps identity-provider groups to client groups, MFA from amr and the shortest key lifetime', () => {
    expect(groupsForRoles(['sales-emea', 'finance', 'other'], groups)).toEqual(['finance', 'sales']);
    expect(groupsForRoles(['other'], groups)).toEqual([]);
    expect(hasMfa(['pwd', 'otp'])).toBe(true);
    expect(hasMfa(['pwd'])).toBe(false);
    expect(hasMfa(undefined)).toBe(false);
    expect(keyLifetimeMs(['finance', 'sales'], groups)).toBe(14 * 86_400_000);
  });

  it('allocates client addresses after the gateway and never the last one', () => {
    expect(allocateClientAddress('100.96.0.0/29', [])).toBe('100.96.0.2');
    expect(allocateClientAddress('100.96.0.0/29', ['100.96.0.2', '100.96.0.3'])).toBe('100.96.0.4');
    expect(
      allocateClientAddress('100.96.0.0/29', ['100.96.0.2', '100.96.0.3', '100.96.0.4', '100.96.0.5', '100.96.0.6']),
    ).toBeNull();
  });

  it('checks posture: core checks, versions, plugin verdicts and stale reports', () => {
    const finance = groups.get('finance')?.posture;

    expect(postureFailures(finance, { posture: posture() }, NOW)).toEqual([]);
    expect(postureFailures(finance, { posture: null }, NOW)).toEqual(['no posture report from this device']);
    expect(
      postureFailures(finance, { posture: posture({ reportedAt: new Date(NOW - 25 * 3_600_000).toISOString() }) }, NOW),
    ).toEqual(['posture report is older than 24 hours']);
    expect(
      postureFailures(
        finance,
        {
          posture: posture({
            report: { platform: 'macos', osVersion: '14.4', diskEncryption: false },
            plugins: { crowdstrike: { verdict: 'high-risk', detail: 'detections' } },
          }),
        },
        NOW,
      ),
    ).toEqual(['disk encryption is off', 'macos 14.4 is older than 14.5', 'crowdstrike: high-risk (detections)']);
    // A plugin that never answered fails closed.
    expect(postureFailures(finance, { posture: posture({ plugins: {} }) }, NOW)).toEqual(['crowdstrike: unknown']);
    expect(compareVersions('10.0.22631', '10.0.9200')).toBe(1);
    expect(compareVersions('14.5', '14.5.0')).toBe(0);
  });

  it('moves failing devices into the restricted group instead of disconnecting them', () => {
    expect(effectiveGroups(client(), groups, NOW)).toEqual(['finance', 'sales']);
    expect(effectiveGroups(client({ posture: null }), groups, NOW)).toEqual(['helpdesk', 'sales']);
    expect(effectiveGroups(client({ groups: ['finance', 'removed'] }), groups, NOW)).toEqual(['finance']);
  });

  it('builds the compiler input: gateways, active holder and valid clients only', () => {
    const resources = [
      {
        kind: 'Cluster',
        name: 'cluster',
        spec: {
          network: { podPoolV4: '10.42.0.0/16', servicePoolV4: '10.43.0.0/16', overlayPoolV4: '10.44.0.0/16' },
          remoteAccess: {
            nodeGroup: 'vpn',
            endpoint: 'vpn.example.com',
            pool: 'vpn-pool',
            clientNetwork: '100.96.0.0/22',
          },
        },
      },
      { kind: 'NodeGroup', name: 'vpn', spec: { selector: { matchLabels: { role: 'vpn' } } } },
      ...[...groups].map(([name, spec]) => ({ kind: 'ClientGroup', name, spec })),
    ];
    const nodes = [
      { name: 'n1', site: 'fra1', labels: { role: 'vpn' }, lifecycle: 'active' },
      { name: 'n2', site: 'fra1', labels: {}, lifecycle: 'active' },
      { name: 'n3', site: 'fra1', labels: { role: 'vpn' }, lifecycle: 'draining' },
    ];
    const input = remoteAccessInput(
      resources,
      nodes,
      [
        client(),
        client({ id: 'revoked', revokedAt: new Date(NOW - 1000) }),
        client({ id: 'expired', expiresAt: new Date(NOW - 1000) }),
      ],
      [{ owner: 'vpn/0', state: 'assigned', holder: 'n1' }],
      NOW,
    );

    expect(input).toMatchObject({
      gateways: ['n1'],
      active: 'n1',
      clientNetwork: '100.96.0.0/22',
      port: 51800,
      groups: ['finance', 'helpdesk', 'sales'],
    });
    expect(input?.clients.map((c) => [c.id, c.label, c.groups])).toEqual([
      ['0b8f7c38-4c55-4a52-9f3e-6a0d1fd4a001', 'alice@example.com/laptop', ['finance', 'sales']],
    ]);
    // A holder outside the gateway group isn't a gateway.
    expect(
      remoteAccessInput(resources, nodes, [], [{ owner: 'vpn/0', state: 'assigned', holder: 'n2' }], NOW)?.active,
    ).toBeUndefined();
    expect(remoteAccessInput([], nodes, [], [], NOW)).toBeUndefined();
  });

  it('rejects overlapping office subnets and unsafe plans', () => {
    expect(
      subnetIssues(
        ['192.168.10.0/24', '192.168.10.128/25', '10.42.5.0/24', 'fd00::/64'],
        ['10.42.0.0/16'],
        [{ name: 'office-hamburg', subnets: ['192.168.10.0/23'] }],
      ),
    ).toEqual([
      '192.168.10.0/24 overlaps 192.168.10.0/23 of office-hamburg',
      '192.168.10.0/24 overlaps 192.168.10.128/25',
      '192.168.10.128/25 overlaps 192.168.10.0/23 of office-hamburg',
      '192.168.10.128/25 overlaps 192.168.10.0/24',
      '10.42.5.0/24 overlaps the cluster range 10.42.0.0/16',
      'fd00::/64 is not an IPv4 network',
    ]);

    const issues = remoteAccessIssues([
      {
        kind: 'Cluster',
        name: 'cluster',
        spec: {
          network: { podPoolV4: '10.42.0.0/16', servicePoolV4: '10.43.0.0/16', overlayPoolV4: '10.44.0.0/16' },
          remoteAccess: { nodeGroup: 'vpn', endpoint: 'vpn.example.com', pool: 'pub', clientNetwork: '10.42.0.0/24' },
        },
      },
      { kind: 'NodeGroup', name: 'vpn', spec: { selector: { matchLabels: { role: 'vpn' } } } },
      {
        kind: 'IpPool',
        name: 'pub',
        spec: { cidrs: ['203.0.113.0/28'], nodeGroup: 'edge', purposes: ['vpn'], failover: 'none' },
      },
      { kind: 'ClientGroup', name: 'a', spec: { restrictedGroup: 'b' } },
      { kind: 'ClientGroup', name: 'b', spec: { posture: { firewall: true } } },
      {
        kind: 'Policy',
        name: 'to-office',
        project: 'shop',
        spec: { from: [{ group: 'api' }], to: [{ clients: 'a' }], rules: [{ ports: [22] }] },
      },
      {
        kind: 'Policy',
        name: 'ghost',
        spec: { from: [{ clients: 'nobody' }], to: [{ builtin: 'cluster' }], rules: [{ ports: [22] }] },
      },
    ]);

    expect(issues).toEqual([
      'IpPool pub must be held by node group vpn (the gateways)',
      'remoteAccess.clientNetwork overlaps the cluster range 10.42.0.0/16',
      "ClientGroup a: restricted group b can't have posture requirements",
      'Policy shop/to-office: remote clients can only be destinations of cluster-wide policies',
      'Policy ghost: client group nobody does not exist',
    ]);
  });

  it('keeps enrolled clients inside the network, the port off the node links and project policies in the project', () => {
    const resources = (port: number) => [
      {
        kind: 'Cluster',
        name: 'cluster',
        spec: {
          network: { podPoolV4: '10.42.0.0/16', servicePoolV4: '10.43.0.0/16', overlayPoolV4: '10.44.0.0/16' },
          remoteAccess: {
            nodeGroup: 'vpn',
            endpoint: 'vpn.example.com',
            pool: 'pub',
            clientNetwork: '100.97.0.0/24',
            port,
          },
        },
      },
      { kind: 'NodeGroup', name: 'vpn', spec: { selector: { matchLabels: { role: 'vpn' } } } },
      { kind: 'ClientGroup', name: 'sales', spec: {} },
      { kind: 'WorkloadGroup', name: 'crm', project: 'shop', spec: { selector: { matchLabels: { app: 'crm' } } } },
      {
        kind: 'Policy',
        name: 'sales-crm',
        project: 'shop',
        spec: { from: [{ clients: 'sales' }], to: [{ group: 'crm' }], rules: [{ ports: [443] }] },
      },
      {
        kind: 'Policy',
        name: 'sales-everywhere',
        project: 'shop',
        spec: { from: [{ clients: 'sales' }], to: [{ builtin: 'control-plane' }], rules: [{ ports: [443] }] },
      },
    ];

    expect(remoteAccessIssues(resources(51850), ['100.96.0.5', '100.97.0.9'])).toEqual([
      'remoteAccess.clientNetwork must contain the addresses of the 1 enrolled client(s) (revoke them first to move the network)',
      'remoteAccess.port 51850 is in the range of the node links (51820–52843)',
      "Policy shop/sales-everywhere: in project policies, remote clients may only reach the project's own workloads",
    ]);
    expect(remoteAccessIssues(resources(51800), ['100.97.0.9'])).toEqual([
      "Policy shop/sales-everywhere: in project policies, remote clients may only reach the project's own workloads",
    ]);
  });

  it('renders the device configuration without a private key', () => {
    expect(
      renderClientConfig({
        config: { address: '100.96.0.10/32', dns: '100.96.0.1', routes: ['10.43.0.10/32', '100.96.0.1/32'], names: [] },
        gatewayPublicKey: 'xTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg=',
        endpoint: 'vpn.example.com',
        port: 51800,
        dnsDomain: 'lw',
      }),
    ).toBe(
      [
        '[Interface]',
        'PrivateKey = <generated on this device>',
        'Address = 100.96.0.10/32',
        'DNS = 100.96.0.1, lw',
        '',
        '[Peer]',
        'PublicKey = xTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg=',
        'Endpoint = vpn.example.com:51800',
        'AllowedIPs = 10.43.0.10/32, 100.96.0.1/32',
        'PersistentKeepalive = 25',
        '',
      ].join('\n'),
    );
  });
});

describe('posture conditions with integrations and certificates', () => {
  const engineering = clientGroupSpecSchema.parse({
    idpGroups: ['eng'],
    posture: {
      conditions: ['mdm.compliant', 'edr.risk <= low', 'device.certificate.valid', 'device.osVersion >= 14'],
    },
    restrictedGroup: 'quarantine',
  });
  const named = new Map([
    ['engineering', engineering],
    ['quarantine', clientGroupSpecSchema.parse({})],
  ]);
  const fact = (extra: Record<string, unknown>) => ({
    integration: 'intune',
    type: 'intune',
    category: 'mdm' as const,
    status: 'compliant' as const,
    reasons: [],
    checkedAt: new Date(NOW - 60_000).toISOString(),
    staleAt: new Date(NOW + 3_600_000).toISOString(),
    ...extra,
  });
  const healthy = () =>
    client({
      groups: ['engineering'],
      certificateSerial: 'abc1',
      posture: posture({
        plugins: {},
        certificate: {
          source: 'loadweaver',
          valid: true,
          revoked: false,
          serialNumber: 'abc1',
          notAfter: new Date(NOW + 10 * 86_400_000).toISOString(),
          reasons: [],
          checkedAt: new Date(NOW - 60_000).toISOString(),
        },
      }),
      integrationPosture: {
        intune: fact({}),
        crowdstrike: fact({ integration: 'crowdstrike', type: 'crowdstrike', category: 'edr', risk: 'low' }),
      },
    });

  it('passes when every condition holds', () => {
    expect(postureFailures(engineering.posture, healthy(), NOW)).toEqual([]);
    expect(effectiveGroups(healthy(), named, NOW)).toEqual(['engineering']);
  });

  it('moves a device with a failing integration into the restricted group, with the reasons', () => {
    const device = healthy();

    device.integrationPosture['intune'] = fact({
      status: 'non-compliant',
      reasons: ['Intune: not compliant with its compliance policies'],
    });
    device.integrationPosture['crowdstrike'] = fact({
      integration: 'crowdstrike',
      type: 'crowdstrike',
      category: 'edr',
      risk: 'high',
      reasons: ['CrowdStrike: the host is network-contained'],
    });

    expect(postureFailures(engineering.posture, device, NOW)).toEqual([
      'Intune: not compliant with its compliance policies',
      'EDR: risk high (CrowdStrike: the host is network-contained)',
    ]);
    expect(effectiveGroups(device, named, NOW)).toEqual(['quarantine']);
  });

  it('fails closed on stale results, missing integrations and superseded certificates', () => {
    const stale = healthy();

    stale.integrationPosture['intune'] = fact({ staleAt: new Date(NOW - 1).toISOString() });
    expect(postureFailures(engineering.posture, stale, NOW)).toEqual(['MDM: the last result is outdated']);

    const none = healthy();

    none.integrationPosture = {};
    expect(postureFailures(engineering.posture, none, NOW)).toEqual([
      'MDM: no result for this device',
      'EDR: no current risk level for this device',
    ]);

    expect(postureFailures(engineering.posture, { ...healthy(), certificateSerial: 'other' }, NOW)).toEqual([
      'the device certificate was superseded or revoked',
    ]);
  });

  it('feeds the effective (restricted) groups into the compiler input', () => {
    const device = healthy();

    device.integrationPosture['intune'] = fact({ status: 'non-compliant' });

    const input = remoteAccessInput(
      [
        {
          kind: 'Cluster',
          name: 'cluster',
          spec: {
            network: { podPoolV4: '10.42.0.0/16', servicePoolV4: '10.43.0.0/16', overlayPoolV4: '10.44.0.0/16' },
            remoteAccess: {
              nodeGroup: 'vpn',
              endpoint: 'vpn.example.com',
              pool: 'vpn-pool',
              clientNetwork: '100.96.0.0/22',
            },
          },
        },
        { kind: 'NodeGroup', name: 'vpn', spec: { selector: { labels: { role: 'vpn' } } } },
        { kind: 'ClientGroup', name: 'engineering', spec: engineering },
        { kind: 'ClientGroup', name: 'quarantine', spec: {} },
      ],
      [{ name: 'gw-1', site: 'fra', labels: { role: 'vpn' }, lifecycle: 'active' }],
      [device],
      [{ owner: 'vpn/0', state: 'assigned', holder: 'gw-1' }],
      NOW,
    );

    expect(input?.clients[0].groups).toEqual(['quarantine']);
  });
});
