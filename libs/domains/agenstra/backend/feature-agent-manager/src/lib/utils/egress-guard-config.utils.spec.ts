import {
  resolveEffectiveEgressPolicy,
  type EffectiveEgressPolicy,
} from '@forepath/agenstra/shared/util-opencode-config';

import {
  computeEgressPolicyRevision,
  normalizeEgressPlatformAllows,
  parseEgressUpstreamProxy,
  renderEgressGuardArtifacts,
} from './egress-guard-config.utils';

function policyFor(egress: Record<string, unknown>): EffectiveEgressPolicy {
  return resolveEffectiveEgressPolicy([{ source: 'global', overlay: { egress } }]);
}

describe('renderEgressGuardArtifacts', () => {
  it('renders every bundle file with a revision', () => {
    const artifacts = renderEgressGuardArtifacts(policyFor({ mode: 'enforce' }));

    expect(Object.keys(artifacts.files).sort()).toEqual(
      [
        'allow-domains.txt',
        'allow-ips.txt',
        'deny-domains.txt',
        'deny-ips.txt',
        'deny-url-patterns.txt',
        'dnsmasq.conf',
        'policy.json',
        'private-ips.txt',
        'rules.v4',
        'rules.v6',
        'squid.conf',
      ].sort(),
    );
    expect(artifacts.revision).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.parse(artifacts.files['policy.json'])).toEqual({
      revision: artifacts.revision,
      mode: 'enforce',
      logAllowed: true,
    });
  });

  it('renders deny lists, private networks and URL patterns in enforce mode', () => {
    const { files } = renderEgressGuardArtifacts(
      policyFor({
        mode: 'enforce',
        deny_hosts: ['example.org', 'sub.example.org', '1.1.1.1'],
        deny_url_patterns: ['/forbidden/'],
      }),
    );

    expect(files['deny-domains.txt']).toBe('.example.org\n');
    expect(files['deny-ips.txt']).toBe('1.1.1.1\n');
    expect(files['deny-url-patterns.txt']).toBe('/forbidden/\n');
    expect(files['private-ips.txt']).toContain('169.254.0.0/16\n');
    expect(files['squid.conf']).toContain('http_access deny !CONNECT deny_domains');
    expect(files['squid.conf']).toContain('http_access deny CONNECT deny_sni');
    expect(files['squid.conf']).toContain('ssl_bump terminate deny_sni');
    expect(files['squid.conf']).toContain('ssl_bump terminate private_dst');
    expect(files['squid.conf']).toContain('http_access deny !CONNECT deny_url');
    expect(files['squid.conf']).toContain('note agenstra_rule deny_host CONNECT deny_sni');
    expect(files['squid.conf']).not.toContain('allow_domains');
    expect(files['squid.conf']).toContain('host_verify_strict on');
    expect(files['dnsmasq.conf']).toContain('address=/example.org/');
    expect(files['dnsmasq.conf']).toContain('stop-dns-rebind');
    expect(files['rules.v4']).toContain('-A AGENSTRA_EGRESS_NAT -p tcp --dport 443 -j REDIRECT --to-ports 3130');
    expect(files['rules.v4']).toContain('-m comment --comment "agenstra:quic" -j REJECT');
    expect(files['rules.v4']).toContain('-m comment --comment "agenstra:undeclared_protocol" -j REJECT');
  });

  it('renders an allowlist with deny precedence and DNS restricted to allowed names', () => {
    const { files } = renderEgressGuardArtifacts(
      policyFor({
        mode: 'enforce',
        allow_hosts: ['github.com', '*.githubusercontent.com', '10.20.0.0/16'],
        deny_hosts: ['gist.github.com'],
      }),
    );

    expect(files['allow-domains.txt']).toBe('.github.com\n.githubusercontent.com\n');
    expect(files['allow-ips.txt']).toBe('10.20.0.0/16\n');
    expect(files['squid.conf']).toContain('http_access deny CONNECT !allow_sni !allow_dst');
    expect(files['squid.conf']).toContain('ssl_bump terminate !allow_sni !allow_dst');
    // Explicitly allowed internal CIDRs are exempt from the private network block.
    expect(files['squid.conf']).toContain('ssl_bump terminate private_dst !allow_sni !allow_dst');
    expect(files['squid.conf'].indexOf('ssl_bump terminate deny_sni')).toBeLessThan(
      files['squid.conf'].indexOf('ssl_bump terminate !allow_sni !allow_dst'),
    );
    expect(files['dnsmasq.conf']).toContain('address=/gist.github.com/');
    expect(files['dnsmasq.conf']).toContain('address=/#/');
    expect(files['dnsmasq.conf']).toContain('server=/github.com/#');
    expect(files['dnsmasq.conf']).toContain('rebind-domain-ok=/github.com/');
  });

  it('renders network exceptions in NAT and filter chains', () => {
    const { files } = renderEgressGuardArtifacts(
      policyFor({
        mode: 'enforce',
        network_allow: [
          { protocol: 'tcp', ports: '22', destinations: ['140.82.112.0/20'] },
          { protocol: 'tcp', ports: '5432-5433', destinations: ['2001:db8::/32'] },
        ],
      }),
    );

    expect(files['rules.v4']).toContain('-A AGENSTRA_EGRESS_NAT -d 140.82.112.0/20 -p tcp --dport 22 -j RETURN');
    expect(files['rules.v4']).toContain(
      '-A AGENSTRA_EGRESS_OUT -d 140.82.112.0/20 -p tcp --dport 22 -m comment --comment "agenstra:network_allow" -j ACCEPT',
    );
    expect(files['rules.v4']).not.toContain('2001:db8');
    expect(files['rules.v6']).toContain('-d 2001:db8::/32 -p tcp --dport 5432:5433');
  });

  it('drops blocked plain HTTP with a TCP reset and answers blocked CONNECT with a bare 403', () => {
    const { files } = renderEgressGuardArtifacts(
      policyFor({ mode: 'enforce', allow_hosts: ['example.org'], deny_hosts: ['203.0.113.7'] }),
    );
    const denyLines = files['squid.conf'].split('\n').filter((line) => line.startsWith('http_access deny'));

    expect(files['squid.conf']).toContain('acl agenstra_drop src all\ndeny_info TCP_RESET agenstra_drop');
    expect(denyLines).toContain('http_access deny !CONNECT deny_dst agenstra_drop');
    expect(denyLines).toContain('http_access deny CONNECT deny_dst');
    expect(denyLines).toContain('http_access deny CONNECT !tls_ports');

    for (const line of denyLines) {
      // Every non-CONNECT denial ends with the reset ACL; CONNECT denials never do.
      expect(line.endsWith(' agenstra_drop')).toBe(!line.startsWith('http_access deny CONNECT '));
    }
  });

  it('exempts only marked proxy traffic and resolver-bound DNS, never a bare UID', () => {
    const { files } = renderEgressGuardArtifacts(policyFor({ mode: 'enforce' }));

    expect(files['squid.conf']).toContain('tcp_outgoing_mark 0x4147 all');
    expect(files['squid.conf']).toContain('dns_nameservers 127.0.0.1');
    expect(files['rules.v4']).toContain('-A AGENSTRA_EGRESS_NAT -m mark --mark 0x4147 -j RETURN');
    expect(files['rules.v4']).toContain('-A AGENSTRA_EGRESS_OUT -m mark --mark 0x4147 -j ACCEPT');
    expect(files['rules.v4']).toContain(
      '-A AGENSTRA_EGRESS_NAT -m owner --uid-owner 10902 -p udp --dport 53 -j RETURN',
    );
    expect(files['rules.v4']).toContain(
      '-A AGENSTRA_EGRESS_OUT -m owner --uid-owner 10902 -j AGENSTRA_EGRESS_RESOLVERS',
    );
    expect(files['rules.v4']).not.toContain('--uid-owner 10901');
    expect(files['rules.v4']).not.toMatch(/--uid-owner 10902 -j (ACCEPT|RETURN)/);
    expect(files['rules.v6']).not.toContain('AGENSTRA_EGRESS_RESOLVERS');
  });

  it('ignores network exceptions in offline mode', () => {
    const { files } = renderEgressGuardArtifacts(
      policyFor({
        mode: 'offline',
        network_allow: [{ protocol: 'tcp', ports: '22', destinations: ['140.82.112.0/20'] }],
      }),
    );

    expect(files['rules.v4']).not.toContain('140.82.112.0/20');
  });

  it('only annotates (never denies) in monitor mode and counts without rejecting', () => {
    const { files } = renderEgressGuardArtifacts(policyFor({ mode: 'monitor', deny_hosts: ['example.org'] }));

    expect(files['squid.conf']).toContain('note agenstra_rule deny_host CONNECT deny_sni');
    expect(files['squid.conf']).not.toContain('http_access deny');
    expect(files['squid.conf']).not.toContain('ssl_bump terminate');
    expect(files['dnsmasq.conf']).not.toContain('address=/');
    expect(files['rules.v4']).toContain(
      '-A AGENSTRA_EGRESS_OUT -p udp --dport 443 -m comment --comment "agenstra:quic"\n',
    );
    expect(files['rules.v4']).not.toContain('-j REJECT');
  });

  it('blocks everything in offline mode and passes everything through when off', () => {
    const offline = renderEgressGuardArtifacts(policyFor({ mode: 'offline' })).files;

    expect(offline['squid.conf']).toContain(
      'http_access deny !CONNECT all agenstra_drop\nhttp_access deny CONNECT all',
    );
    expect(offline['squid.conf']).toContain('ssl_bump terminate all');
    expect(offline['dnsmasq.conf']).toContain('address=/#/');

    const off = renderEgressGuardArtifacts(policyFor({ mode: 'off' })).files;

    expect(off['rules.v4']).not.toContain('REDIRECT');
    expect(off['rules.v4']).toContain('-A AGENSTRA_EGRESS_OUT -j ACCEPT');
    expect(off['rules.v6']).toContain('-A AGENSTRA_EGRESS_OUT -j ACCEPT');
  });

  it('logs only annotated decisions when allowed traffic logging is disabled', () => {
    const { files } = renderEgressGuardArtifacts(policyFor({ mode: 'enforce', log_allowed: false }));

    expect(files['squid.conf']).toContain('access_log stdio:/var/log/agenstra-egress/access.log agenstra has_rule');
  });

  it('chains the configured upstream proxy and keeps NO_PROXY hosts direct', () => {
    const upstream = parseEgressUpstreamProxy('http://user:secret@proxy.corp:8080', 'internal.corp, localhost');
    const { files } = renderEgressGuardArtifacts(policyFor({ mode: 'enforce' }), upstream);

    expect(files['squid.conf']).toContain(
      'cache_peer proxy.corp parent 8080 0 no-query no-digest default name=agenstra_upstream login=user:secret',
    );
    expect(files['squid.conf']).toContain('acl upstream_bypass dstdomain -n .internal.corp');
    expect(files['squid.conf']).toContain('never_direct allow all');
  });

  it('never renders unvalidated values (configuration injection)', () => {
    const malicious = {
      ...policyFor({ mode: 'enforce' }),
      denyHosts: [
        { value: 'evil.example\nhttp_access allow all', source: 'global' },
        { value: 'ok.example', source: 'global' },
      ],
      denyUrlPatterns: [{ value: 'a\nb', source: 'global' }],
      networkAllow: [{ protocol: 'tcp', ports: '22 -j ACCEPT', destinations: ['1.1.1.1'], source: 'global' }],
    } as unknown as EffectiveEgressPolicy;
    const { files } = renderEgressGuardArtifacts(malicious);

    expect(files['deny-domains.txt']).toBe('.ok.example\n');
    expect(files['deny-url-patterns.txt']).toBe('');
    expect(files['rules.v4']).not.toContain('--dport 22 -j ACCEPT -j');
    expect(Object.values(files).join('\n')).not.toContain('http_access allow all\nhttp_access');
  });
});

describe('Git over SSH', () => {
  const gitHosts = ['bitbucket.org', 'github.com', 'gitlab.com'];

  it('accepts TCP 22 only to addresses dnsmasq resolved for Git hosts (enforce)', () => {
    const { files } = renderEgressGuardArtifacts(policyFor({ mode: 'enforce' }), null, gitHosts);

    expect(files['dnsmasq.conf']).toContain(
      'ipset=/bitbucket.org/github.com/gitlab.com/agenstra_git_ssh4,agenstra_git_ssh6',
    );
    expect(files['rules.v4']).toContain(
      '-A AGENSTRA_EGRESS_OUT -p tcp --dport 22 -m set --match-set agenstra_git_ssh4 dst -m comment --comment "agenstra:git_ssh" -j ACCEPT',
    );
    expect(files['rules.v6']).toContain('--match-set agenstra_git_ssh6 dst');
    // The accept rule precedes the final reject of undeclared protocols.
    expect(files['rules.v4'].indexOf('agenstra:git_ssh')).toBeLessThan(
      files['rules.v4'].indexOf('agenstra:undeclared_protocol'),
    );
    // No IP is ever accepted on port 22 without the set match.
    expect(files['rules.v4']).not.toMatch(/--dport 22 (?!-m set)/);
  });

  it('lets Git hosts resolve under an allowlist (web access is still decided by Squid)', () => {
    const { files } = renderEgressGuardArtifacts(
      policyFor({ mode: 'enforce', allow_hosts: ['example.org'] }),
      null,
      gitHosts,
    );

    expect(files['dnsmasq.conf']).toContain('server=/github.com/#');
    expect(files['allow-domains.txt']).toBe('.example.org\n');
  });

  it('honours the deny list and never applies to offline, monitor or off policies', () => {
    const denied = renderEgressGuardArtifacts(
      policyFor({ mode: 'enforce', deny_hosts: ['github.com'] }),
      null,
      gitHosts,
    ).files;

    expect(denied['dnsmasq.conf']).toContain('ipset=/bitbucket.org/gitlab.com/agenstra_git_ssh4');
    expect(denied['dnsmasq.conf']).not.toContain('ipset=/bitbucket.org/github.com');

    for (const mode of ['offline', 'monitor', 'off']) {
      const files = renderEgressGuardArtifacts(policyFor({ mode }), null, gitHosts).files;

      expect(files['dnsmasq.conf']).not.toContain('ipset=');
      expect(files['rules.v4']).not.toContain('agenstra_git_ssh4');
    }
  });

  it('renders nothing when Git over SSH is disabled and changes the revision with the host list', () => {
    const policy = policyFor({ mode: 'enforce' });
    const { files, revision } = renderEgressGuardArtifacts(policy, null, []);

    expect(files['dnsmasq.conf']).not.toContain('ipset=');
    expect(files['rules.v4']).not.toContain('--dport 22');
    expect(revision).not.toBe(computeEgressPolicyRevision(policy, null, gitHosts));
  });
});

describe('computeEgressPolicyRevision', () => {
  it('is stable and changes with policy or upstream', () => {
    const policy = policyFor({ mode: 'enforce', deny_hosts: ['a.example'] });

    expect(computeEgressPolicyRevision(policy)).toBe(computeEgressPolicyRevision({ ...policy }));
    expect(computeEgressPolicyRevision(policy)).not.toBe(
      computeEgressPolicyRevision(policyFor({ mode: 'enforce', deny_hosts: ['b.example'] })),
    );
    expect(computeEgressPolicyRevision(policy)).not.toBe(
      computeEgressPolicyRevision(policy, parseEgressUpstreamProxy('http://proxy:3128', null)),
    );
    // Provenance does not change what the guard enforces.
    expect(computeEgressPolicyRevision(policy)).toBe(
      computeEgressPolicyRevision({ ...policy, scalarSources: { ...policy.scalarSources, mode: 'workspace' } }),
    );
  });
});

describe('parseEgressUpstreamProxy', () => {
  it('parses host, port, credentials and bypass list', () => {
    expect(parseEgressUpstreamProxy('proxy.corp:3128', 'a.corp,*.b.corp,10.0.0.1')).toEqual({
      host: 'proxy.corp',
      port: 3128,
      bypassHosts: ['a.corp', 'b.corp'],
    });
    expect(parseEgressUpstreamProxy('http://u%40x:p%3Aw@proxy:80', null)).toEqual({
      host: 'proxy',
      port: 80,
      username: 'u@x',
      password: 'p:w',
      bypassHosts: [],
    });
  });

  it('rejects unsupported schemes and drops unsafe credentials', () => {
    expect(parseEgressUpstreamProxy('http://u%zz:p@proxy:8080', null)).toEqual({
      host: 'proxy',
      port: 8080,
      bypassHosts: [],
    });
    expect(parseEgressUpstreamProxy('https://proxy:443', null)).toBeNull();
    expect(parseEgressUpstreamProxy('', null)).toBeNull();
    expect(parseEgressUpstreamProxy('http://u:p%20w@proxy:8080', null)).toEqual({
      host: 'proxy',
      port: 8080,
      username: 'u',
      bypassHosts: [],
    });
  });
});

describe('platform allows (agent context MCP → manager)', () => {
  const manager = [
    { destination: '172.18.0.5', port: 3000 },
    { destination: 'fd00::5', port: 3000 },
  ];

  it('keeps the manager reachable in enforce and offline mode, bypassing the web intercept', () => {
    for (const mode of ['enforce', 'offline'] as const) {
      const { files } = renderEgressGuardArtifacts(policyFor({ mode }), null, [], manager);

      expect(files['rules.v4']).toContain('-A AGENSTRA_EGRESS_OUT -d 172.18.0.5 -p tcp --dport 3000 -j ACCEPT');
      expect(files['rules.v4']).toContain('-A AGENSTRA_EGRESS_NAT -d 172.18.0.5 -p tcp --dport 3000 -j RETURN');
      expect(files['rules.v6']).toContain('-A AGENSTRA_EGRESS_OUT -d fd00::5 -p tcp --dport 3000 -j ACCEPT');
      expect(files['rules.v4']).not.toContain('fd00::5');
    }
  });

  it('places the allow before the final reject', () => {
    const rules = renderEgressGuardArtifacts(policyFor({ mode: 'enforce' }), null, [], manager).files['rules.v4'].split(
      '\n',
    );
    const allow = rules.findIndex((line) => line.includes('-d 172.18.0.5 -p tcp --dport 3000 -j ACCEPT'));
    const reject = rules.findIndex((line) => line.includes('undeclared_protocol') && line.endsWith('-j REJECT'));

    expect(allow).toBeGreaterThan(-1);
    expect(allow).toBeLessThan(reject);
  });

  it('answers the manager host name locally in every guarded mode (allowlist, offline, rebind protection)', () => {
    const named = [
      { destination: '172.18.0.5', port: 3000, hostname: 'agent-manager-api' },
      { destination: 'fd00::5', port: 3000, hostname: 'agent-manager-api' },
    ];

    for (const egress of [
      { mode: 'enforce', allow_hosts: ['github.com'] },
      { mode: 'enforce' },
      { mode: 'offline' },
      { mode: 'monitor' },
    ]) {
      const dnsmasq = renderEgressGuardArtifacts(policyFor(egress), null, [], named).files['dnsmasq.conf'];

      expect(dnsmasq).toContain('host-record=agent-manager-api,172.18.0.5,fd00::5');
    }

    expect(renderEgressGuardArtifacts(policyFor({ mode: 'off' }), null, [], named).files['dnsmasq.conf']).not.toContain(
      'host-record',
    );
  });

  it('never renders wildcard or invalid platform host names', () => {
    expect(
      normalizeEgressPlatformAllows([
        { destination: '10.0.0.1', port: 3000, hostname: '*.example.org' },
        { destination: '10.0.0.2', port: 3000, hostname: 'bad host\nserver=/#/8.8.8.8' },
        { destination: '10.0.0.3', port: 3000, hostname: 'Agent-Manager-API' },
      ]),
    ).toEqual([
      { destination: '10.0.0.1', port: 3000 },
      { destination: '10.0.0.2', port: 3000 },
      { destination: '10.0.0.3', port: 3000, hostname: 'agent-manager-api' },
    ]);
  });

  it('drops non-IP destinations and invalid ports (never renders unvalidated values)', () => {
    expect(
      normalizeEgressPlatformAllows([
        { destination: 'agent-manager-api', port: 3000 },
        { destination: '10.0.0.1; rm -rf /', port: 3000 },
        { destination: '10.0.0.1', port: 0 },
        { destination: '10.0.0.1', port: 70000 },
        { destination: '10.0.0.1', port: 3000 },
        { destination: '10.0.0.1', port: 3000 },
      ]),
    ).toEqual([{ destination: '10.0.0.1', port: 3000 }]);
  });

  it('only changes the revision when platform allows are present', () => {
    const policy = policyFor({ mode: 'enforce' });

    expect(computeEgressPolicyRevision(policy, null, [], [])).toBe(computeEgressPolicyRevision(policy, null, []));
    expect(computeEgressPolicyRevision(policy, null, [], manager)).not.toBe(
      computeEgressPolicyRevision(policy, null, []),
    );
  });
});
