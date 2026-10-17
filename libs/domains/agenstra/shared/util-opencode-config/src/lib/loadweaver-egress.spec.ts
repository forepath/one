import { normalizeEffectiveEgressPolicy, resolveEffectiveEgressPolicy } from './egress-policy';
import {
  compileEgressPolicyForLoadweaver,
  loadweaverEgressNetwork,
  loadweaverWorkspacePolicies,
} from './loadweaver-egress';

const target = { project: 'agenstra-ws', deployment: 'env-0123456789abcdef0123456789abcdef' };
const entry = (value: string) => ({ value, source: 'workspace' as const });
const policy = (overrides: Record<string, unknown>) =>
  normalizeEffectiveEgressPolicy({ ...resolveEffectiveEgressPolicy([]), ...overrides });
const specs = (result: ReturnType<typeof compileEgressPolicyForLoadweaver>) =>
  Object.fromEntries(result.documents.map((d) => [d.metadata.name.slice(target.deployment.length), d.spec]));

describe('Agenstra egress policy → Loadweaver policies', () => {
  it('compiles mode, settings, allow / deny hosts and addresses, URL patterns and network_allow', () => {
    const result = compileEgressPolicyForLoadweaver(
      policy({
        mode: 'enforce',
        allowHosts: [entry('github.com'), entry('*.npmjs.org'), entry('10.1.2.0/24'), entry('203.0.113.7')],
        denyHosts: [entry('gist.github.com'), entry('198.51.100.0/24')],
        denyUrlPatterns: [entry('/admin')],
        networkAllow: [
          { protocol: 'tcp', ports: '22', destinations: ['192.0.2.10'], source: 'workspace' },
          { protocol: 'udp', ports: '5000-5010', destinations: ['192.0.2.0/28'], source: 'global' },
        ],
        blockIpLiterals: true,
        logAllowed: false,
      }),
      target,
    );
    const from = [{ selector: { matchLabels: { 'loadweaver.com/deployment': target.deployment } } }];
    const web = [{ protocol: 'tcp', ports: [80, 443] }];

    expect(result.issues).toEqual([]);
    expect(result.network).toBe('filtered');
    expect(result.prefix).toBe(`${target.deployment}-egress`);
    expect(specs(result)).toEqual({
      '-egress': expect.objectContaining({
        from,
        egressMode: 'enforce',
        denyUrlPatterns: ['/admin'],
        blockPrivateNetworks: true,
        blockIpLiterals: true,
        logAllowed: false,
      }),
      // `*.npmjs.org` is `npmjs.org` and its subdomains in Agenstra: the same as Loadweaver's `npmjs.org`.
      '-egress-allow': expect.objectContaining({ to: [{ host: 'github.com' }, { host: 'npmjs.org' }], rules: web }),
      '-egress-allow-addr': expect.objectContaining({
        to: [{ cidr: '10.1.2.0/24' }, { cidr: '203.0.113.7/32' }],
        rules: web,
      }),
      '-egress-deny': expect.objectContaining({ action: 'deny', to: [{ host: 'gist.github.com' }], rules: web }),
      '-egress-deny-addr': expect.objectContaining({ action: 'deny', to: [{ cidr: '198.51.100.0/24' }], rules: web }),
      '-egress-net-0': expect.objectContaining({
        to: [{ cidr: '192.0.2.10/32' }],
        rules: [{ protocol: 'tcp', ports: [22] }],
      }),
      '-egress-net-1': expect.objectContaining({
        to: [{ cidr: '192.0.2.0/28' }],
        rules: [{ protocol: 'udp', ports: ['5000-5010'] }],
      }),
    });
    expect(result.documents.every((d) => d.metadata.project === 'agenstra-ws' && d.kind === 'Policy')).toBe(true);
  });

  it('only sets the mode when off (nothing is filtered or recorded)', () => {
    const result = compileEgressPolicyForLoadweaver(policy({ allowHosts: [entry('github.com')] }), target);

    expect(result.documents.map((d) => d.metadata.name)).toEqual([`${target.deployment}-egress`]);
    expect(result.network).toBe('open');
  });

  it('reports hosts Loadweaver cannot express', () => {
    const result = compileEgressPolicyForLoadweaver(
      policy({ mode: 'enforce', allowHosts: [entry('my_host.internal')] }),
      target,
    );

    expect(result.issues).toEqual([expect.stringContaining("'my_host.internal'")]);
  });

  it('maps modes to the standing internet policy classes', () => {
    expect(['off', 'monitor', 'enforce', 'offline'].map((m) => loadweaverEgressNetwork(m as never))).toEqual([
      'open',
      'open',
      'filtered',
      'filtered',
    ]);
  });

  it('describes the standing workspace policies', () => {
    const docs = loadweaverWorkspacePolicies('agenstra-ws');

    expect(docs.map((d) => d.metadata.name)).toEqual([
      'agenstra-manager-environments',
      'agenstra-environments-open',
      'agenstra-environments-web',
    ]);
    expect(docs[0].spec['rules']).toEqual([{ protocol: 'tcp', ports: [4096, 6080] }]);
  });
});
