import {
  assertOverlayRespectsHeredity,
  assertValidPlatformSecurityConfig,
  compactEgressHostEntries,
  composeLayerOverlay,
  computeHeredityMetadata,
  evaluateEgressDestination,
  evaluateMessageFilters,
  expandExplicitLocks,
  explainEgressRule,
  hasNestedQuantifier,
  isIpLiteralHost,
  isPrivateNetworkAddress,
  mergeConfigs,
  normalizeEgressHost,
  normalizeMessageFilterFlags,
  OpencodeConfigValidationError,
  parseEgressPortSpec,
  prepareConfigForSync,
  redactEgressUrl,
  resolveEffectiveEgressPolicy,
  resolveEffectiveMessageFilters,
  resolvePlatformSecurityPolicy,
  stablePlatformPolicyJson,
  validateEgressUrlPattern,
  validateOverlayAgainstHeredity,
  type EffectiveEgressPolicy,
} from './agenstra-shared-util-opencode-config';

function policy(overrides: Partial<EffectiveEgressPolicy> = {}): EffectiveEgressPolicy {
  return {
    ...resolveEffectiveEgressPolicy([]),
    mode: 'enforce',
    ...overrides,
  };
}

describe('normalizeEgressHost', () => {
  it('normalizes domains and wildcard prefixes to the registrable suffix form', () => {
    expect(normalizeEgressHost('Example.COM')).toEqual({ kind: 'domain', value: 'example.com' });
    expect(normalizeEgressHost('*.example.com')).toEqual({ kind: 'domain', value: 'example.com' });
    expect(normalizeEgressHost('.example.com.')).toEqual({ kind: 'domain', value: 'example.com' });
  });

  it('normalizes IP addresses and CIDRs (host bits masked)', () => {
    expect(normalizeEgressHost('10.1.2.3/8')).toEqual({ kind: 'ipv4', value: '10.0.0.0/8', prefix: 8 });
    expect(normalizeEgressHost('203.0.113.10')).toEqual({ kind: 'ipv4', value: '203.0.113.10', prefix: 32 });
    expect(normalizeEgressHost('2001:DB8::1')).toEqual({ kind: 'ipv6', value: '2001:db8::1', prefix: 128 });
    expect(normalizeEgressHost('2001:db8:0:0:1::/64')).toEqual({ kind: 'ipv6', value: '2001:db8::/64', prefix: 64 });
  });

  it('rejects URLs, ports, paths and malformed values', () => {
    for (const invalid of [
      'https://example.com',
      'example.com/path',
      'example.com:443',
      'exa mple.com',
      '-bad.example',
      '999.1.1.1',
      '10.0.0.0/33',
      '',
      42,
    ]) {
      expect(normalizeEgressHost(invalid)).toBeNull();
    }
  });
});

describe('IP helpers', () => {
  it('detects private and reserved ranges (including IPv4-mapped IPv6)', () => {
    expect(isPrivateNetworkAddress('10.0.0.5')).toBe(true);
    expect(isPrivateNetworkAddress('169.254.169.254')).toBe(true);
    expect(isPrivateNetworkAddress('172.20.1.1')).toBe(true);
    expect(isPrivateNetworkAddress('fd00::1')).toBe(true);
    expect(isPrivateNetworkAddress('[::1]')).toBe(true);
    expect(isPrivateNetworkAddress('::ffff:192.168.1.1')).toBe(true);
    expect(isPrivateNetworkAddress('140.82.121.4')).toBe(false);
    expect(isPrivateNetworkAddress('github.com')).toBe(false);
  });

  it('detects IP literal hosts', () => {
    expect(isIpLiteralHost('1.2.3.4')).toBe(true);
    expect(isIpLiteralHost('[2001:db8::1]')).toBe(true);
    expect(isIpLiteralHost('example.com')).toBe(false);
  });

  it('parses port specs', () => {
    expect(parseEgressPortSpec('22')).toEqual({ from: 22, to: 22 });
    expect(parseEgressPortSpec('1000-2000')).toEqual({ from: 1000, to: 2000 });
    expect(parseEgressPortSpec('0')).toBeNull();
    expect(parseEgressPortSpec('2000-1000')).toBeNull();
    expect(parseEgressPortSpec('70000')).toBeNull();
  });
});

describe('compactEgressHostEntries', () => {
  it('removes duplicates and entries covered by broader ones', () => {
    expect(
      compactEgressHostEntries([
        { value: 'api.example.com' },
        { value: 'example.com' },
        { value: '*.example.com' },
        { value: '10.1.0.0/16' },
        { value: '10.0.0.0/8' },
        { value: 'github.com' },
      ]).map((entry) => entry.value),
    ).toEqual(['example.com', '10.0.0.0/8', 'github.com']);
  });
});

describe('validateEgressUrlPattern', () => {
  it('accepts plain patterns and rejects whitespace, lookarounds and invalid regex', () => {
    expect(validateEgressUrlPattern('^http://[^/]+/forbidden/')).toBeNull();
    expect(validateEgressUrlPattern('a b')).toMatch(/whitespace/);
    expect(validateEgressUrlPattern('(?=x)')).toMatch(/lookarounds/);
    expect(validateEgressUrlPattern('(')).toMatch(/valid/);
  });
});

describe('assertValidPlatformSecurityConfig', () => {
  it('accepts a complete egress configuration', () => {
    expect(() =>
      assertValidPlatformSecurityConfig({
        egress: {
          mode: 'enforce',
          allow_hosts: ['github.com', '*.npmjs.org', '203.0.113.0/24'],
          deny_hosts: ['example.org'],
          deny_url_patterns: ['^http://[^/]+/forbidden/'],
          network_allow: [{ protocol: 'tcp', ports: '22', destinations: ['203.0.113.10'], description: 'git ssh' }],
          block_private_networks: true,
          block_ip_literals: false,
          log_allowed: true,
        },
      }),
    ).not.toThrow();
  });

  it.each([
    [{ egress: [] }, /must be an object/],
    [{ egress: { mode: 'strict' } }, /mode/],
    [{ egress: { unknown: true } }, /Unknown keys/],
    [{ egress: { allow_hosts: ['https://github.com'] } }, /allow_hosts\/0/],
    [{ egress: { deny_hosts: 'github.com' } }, /array/],
    [{ egress: { block_private_networks: 'yes' } }, /boolean/],
    [{ egress: { network_allow: [{ protocol: 'icmp', ports: '1', destinations: ['1.1.1.1'] }] } }, /protocol/],
    [{ egress: { network_allow: [{ protocol: 'tcp', ports: 'ssh', destinations: ['1.1.1.1'] }] } }, /ports/],
    [{ egress: { network_allow: [{ protocol: 'tcp', ports: '22', destinations: ['github.com'] }] } }, /IP address/],
    [{ egress: { network_allow: [{ protocol: 'tcp', ports: '22', destinations: [] }] } }, /at least one/],
  ])('rejects invalid egress config %#', (overlay, message) => {
    expect(() => assertValidPlatformSecurityConfig(overlay)).toThrow(OpencodeConfigValidationError);
    expect(() => assertValidPlatformSecurityConfig(overlay)).toThrow(message);
  });

  it('validates message filter rules', () => {
    expect(() =>
      assertValidPlatformSecurityConfig({
        message_filters: [
          { name: 'Secrets', pattern: 'sk-[a-z0-9]+', flags: 'gi', direction: 'bidirectional', action: 'drop' },
          { name: 'Mask', pattern: 'secret', action: 'replace', replacement: '***' },
        ],
      }),
    ).not.toThrow();

    expect(() => assertValidPlatformSecurityConfig({ message_filters: {} })).toThrow(/array/);
    expect(() =>
      assertValidPlatformSecurityConfig({ message_filters: [{ name: 'x', pattern: 'a', action: 'replace' }] }),
    ).toThrow(/replacement/);
    expect(() =>
      assertValidPlatformSecurityConfig({ message_filters: [{ name: 'x', pattern: '(', action: 'drop' }] }),
    ).toThrow(/Invalid regular expression/);
    expect(() =>
      assertValidPlatformSecurityConfig({ message_filters: [{ name: 'x', pattern: '(a+)+$', action: 'drop' }] }),
    ).toThrow(/nested quantifiers/);
    expect(() =>
      assertValidPlatformSecurityConfig({ message_filters: [{ name: 'x', pattern: 'a', flags: 'x', action: 'drop' }] }),
    ).toThrow(/flag/);
    expect(() =>
      assertValidPlatformSecurityConfig({
        message_filters: [
          { name: 'dup', pattern: 'a', action: 'drop' },
          { name: 'dup', pattern: 'b', action: 'flag' },
        ],
      }),
    ).toThrow(/duplicates/);
  });

  it('is enforced by heredity validation (structured and raw editors)', () => {
    expect(validateOverlayAgainstHeredity({ egress: { mode: 'nope' } }, [], [])).toMatch(/mode/);
    expect(() => assertOverlayRespectsHeredity({ message_filters: [{ name: 'x' }] }, [], [])).toThrow(/pattern/);
  });
});

describe('hasNestedQuantifier / normalizeMessageFilterFlags', () => {
  it('flags nested quantifiers only', () => {
    expect(hasNestedQuantifier('(a+)+')).toBe(true);
    expect(hasNestedQuantifier('((ab*))*')).toBe(true);
    expect(hasNestedQuantifier('(?:ab)+')).toBe(false);
    expect(hasNestedQuantifier('[(a+)]+')).toBe(false);
    expect(hasNestedQuantifier('\\(a+\\)+')).toBe(false);
    expect(hasNestedQuantifier('(a+)?')).toBe(false);
    expect(hasNestedQuantifier('(a|aa)+$')).toBe(true);
    expect(hasNestedQuantifier('(?:\\w|x)*')).toBe(true);
    expect(hasNestedQuantifier('(?<word>Foo|foo)+')).toBe(true);
    expect(hasNestedQuantifier('(foo|bar)+')).toBe(false);
    expect(hasNestedQuantifier('(?:foo|bar)?')).toBe(false);
    expect(hasNestedQuantifier('foo|foobar')).toBe(false);
  });

  it('dedupes flags and defaults to global', () => {
    expect(normalizeMessageFilterFlags(undefined)).toBe('g');
    expect(normalizeMessageFilterFlags('gig')).toBe('gi');
  });
});

describe('egress merge and heredity', () => {
  it('merges egress per field: higher layers win scalars, lists concatenate', () => {
    const merged = mergeConfigs(
      { egress: { mode: 'monitor', allow_hosts: ['agent.example'] } },
      { egress: { allow_hosts: ['workspace.example'], deny_hosts: ['bad.example'] } },
      { egress: { mode: 'enforce', allow_hosts: ['agent.example'] } },
    );

    expect(merged['egress']).toEqual({
      mode: 'enforce',
      allow_hosts: ['agent.example', 'workspace.example'],
      deny_hosts: ['bad.example'],
    });
  });

  it('composes structured config with overrides', () => {
    expect(composeLayerOverlay({ egress: { mode: 'monitor' } }, { egress: { deny_hosts: ['x.example'] } })).toEqual({
      egress: { mode: 'monitor', deny_hosts: ['x.example'] },
    });
  });

  it('concatenates message filters across layers', () => {
    const merged = mergeConfigs(
      { message_filters: [{ name: 'a', pattern: 'a', action: 'flag' }] },
      { message_filters: [{ name: 'b', pattern: 'b', action: 'drop' }] },
    );

    expect(merged['message_filters']).toHaveLength(2);
  });

  it('locks parent egress scalars and exposes list entries as additive', () => {
    const meta = computeHeredityMetadata({
      egress: { mode: 'enforce', deny_hosts: ['bad.example'], allow_hosts: [] },
      message_filters: [{ name: 'a', pattern: 'a', action: 'drop' }],
    });

    expect(meta.lockedPaths).toContain('/egress/mode');
    expect(meta.lockedPaths).not.toContain('/egress');
    expect(meta.inheritedAdditive).toEqual(
      expect.arrayContaining([
        { path: '/egress/deny_hosts', items: ['bad.example'] },
        { path: '/message_filters', items: [{ name: 'a', pattern: 'a', action: 'drop' }] },
      ]),
    );
    expect(() => assertOverlayRespectsHeredity({ egress: { mode: 'off' } }, meta.lockedPaths, [])).toThrow(/locked/);
    expect(() =>
      assertOverlayRespectsHeredity({ egress: { deny_hosts: ['more.example'] } }, meta.lockedPaths, []),
    ).not.toThrow();
  });

  it('expands the egress and message filter tab locks', () => {
    expect(expandExplicitLocks(['/tabs/egress', '/tabs/message_filters'])).toEqual(
      expect.arrayContaining(['/egress', '/egress/mode', '/egress/allow_hosts', '/message_filters']),
    );
    expect(() =>
      assertOverlayRespectsHeredity({ egress: { allow_hosts: ['x.example'] } }, expandExplicitLocks(['/tabs/egress'])),
    ).toThrow(/locked/);
  });

  it('never sends platform security roots to the OpenCode worker', () => {
    const wire = prepareConfigForSync({
      egress: { mode: 'enforce' },
      message_filters: [{ name: 'a', pattern: 'a', action: 'drop' }],
      share: 'manual',
    });

    expect(wire).not.toHaveProperty('egress');
    expect(wire).not.toHaveProperty('message_filters');
    expect(wire['share']).toBe('manual');
  });
});

describe('resolveEffectiveEgressPolicy', () => {
  it('defaults to off with private networks blocked', () => {
    const resolved = resolveEffectiveEgressPolicy([]);

    expect(resolved.mode).toBe('off');
    expect(resolved.blockPrivateNetworks).toBe(true);
    expect(resolved.scalarSources.mode).toBeNull();
  });

  it('applies global → workspace → environment precedence with provenance', () => {
    const resolved = resolveEffectiveEgressPolicy([
      { source: 'environment', overlay: { egress: { mode: 'off', allow_hosts: ['api.github.com', 'github.com'] } } },
      { source: 'global', overlay: { egress: { mode: 'enforce', allow_hosts: ['github.com'] } } },
      {
        source: 'workspace',
        overlay: {
          egress: {
            log_allowed: false,
            deny_hosts: ['Bad.Example'],
            network_allow: [{ protocol: 'tcp', ports: '22', destinations: ['203.0.113.10/32'] }],
          },
        },
      },
    ]);

    expect(resolved.mode).toBe('enforce');
    expect(resolved.scalarSources.mode).toBe('global');
    expect(resolved.logAllowed).toBe(false);
    expect(resolved.scalarSources.logAllowed).toBe('workspace');
    expect(resolved.allowHosts).toEqual([
      { value: 'github.com', source: 'global' },
      { value: 'api.github.com', source: 'environment' },
    ]);
    expect(resolved.denyHosts).toEqual([{ value: 'bad.example', source: 'workspace' }]);
    expect(resolved.networkAllow).toEqual([
      { protocol: 'tcp', ports: '22', destinations: ['203.0.113.10'], source: 'workspace' },
    ]);
  });

  it('never lets lower layers widen an inherited allowlist', () => {
    const resolved = resolveEffectiveEgressPolicy([
      { source: 'global', overlay: { egress: { mode: 'enforce', allow_hosts: ['github.com', '10.0.0.0/8'] } } },
      {
        source: 'workspace',
        overlay: { egress: { allow_hosts: ['evil.example', 'raw.github.com', '10.1.0.0/16', '0.0.0.0/0'] } },
      },
    ]);

    expect(resolved.allowHosts.map((entry) => entry.value)).toEqual([
      'github.com',
      '10.0.0.0/8',
      'raw.github.com',
      '10.1.0.0/16',
    ]);
    expect(evaluateEgressDestination(resolved, 'evil.example').decision).toBe('blocked');
  });

  it('lets lower layers add allow entries when no higher layer restricts', () => {
    const resolved = resolveEffectiveEgressPolicy([
      { source: 'global', overlay: { egress: { mode: 'enforce' } } },
      { source: 'environment', overlay: { egress: { allow_hosts: ['example.org'] } } },
    ]);

    expect(resolved.allowHosts).toEqual([{ value: 'example.org', source: 'environment' }]);
  });

  it('bounds lower-layer network exceptions by inherited ones', () => {
    const resolved = resolveEffectiveEgressPolicy([
      {
        source: 'global',
        overlay: { egress: { network_allow: [{ protocol: 'tcp', ports: '22-23', destinations: ['203.0.113.0/24'] }] } },
      },
      {
        source: 'workspace',
        overlay: {
          egress: {
            network_allow: [
              { protocol: 'tcp', ports: '22', destinations: ['203.0.113.10'] },
              { protocol: 'tcp', ports: '1-65535', destinations: ['0.0.0.0/0'] },
              { protocol: 'udp', ports: '22', destinations: ['203.0.113.10'] },
            ],
          },
        },
      },
    ]);

    expect(resolved.networkAllow.map((rule) => [rule.protocol, rule.ports, rule.destinations, rule.source])).toEqual([
      ['tcp', '22-23', ['203.0.113.0/24'], 'global'],
      ['tcp', '22', ['203.0.113.10'], 'workspace'],
    ]);
  });
});

describe('egress URL pattern safety', () => {
  it.each([
    ['(?:a|b)/x', /special groups/],
    ['a.*?b', /lazy/],
    ['\\d+/admin', /escape classes/],
    ['#comment', /must not start/],
    ['(a+)+$', /catastrophic/],
    ['(a|aa)+$', /catastrophic/],
  ])('rejects %s', (pattern, message) => {
    expect(validateEgressUrlPattern(pattern)).toMatch(message);
    expect(() => assertValidPlatformSecurityConfig({ egress: { deny_url_patterns: [pattern] } })).toThrow(
      OpencodeConfigValidationError,
    );
  });

  it('accepts POSIX-compatible patterns', () => {
    expect(validateEgressUrlPattern('^http://[^/]+/admin(/|$)')).toBeNull();
    expect(validateEgressUrlPattern('\\.exe$')).toBeNull();
  });

  it('ignores unsafe stored patterns during evaluation', () => {
    const resolved = policy({ denyUrlPatterns: [{ value: '(a|aa)+$', source: 'global' }] });

    expect(
      evaluateEgressDestination(resolved, 'h.example', { url: `http://h.example/${'a'.repeat(40)}!`, scheme: 'http' })
        .decision,
    ).toBe('allowed');
  });
});

describe('evaluateEgressDestination', () => {
  it('allows everything when off', () => {
    expect(evaluateEgressDestination(policy({ mode: 'off' }), 'anything.example')).toEqual({
      decision: 'allowed',
      rule: null,
    });
  });

  it('lets the denylist win over the allowlist', () => {
    const resolved = policy({
      allowHosts: [{ value: 'example.com', source: 'global' }],
      denyHosts: [{ value: 'secret.example.com', source: 'workspace' }],
    });

    expect(evaluateEgressDestination(resolved, 'api.example.com').decision).toBe('allowed');
    expect(evaluateEgressDestination(resolved, 'x.secret.example.com')).toEqual({
      decision: 'blocked',
      rule: 'deny_host',
      matchedEntry: 'secret.example.com',
      source: 'workspace',
    });
    expect(evaluateEgressDestination(resolved, 'other.org')).toEqual({ decision: 'blocked', rule: 'not_allowlisted' });
  });

  it('treats an empty allowlist as unrestricted', () => {
    expect(evaluateEgressDestination(policy(), 'other.org').decision).toBe('allowed');
  });

  it('blocks private networks, IP literals and HTTP URL patterns', () => {
    expect(evaluateEgressDestination(policy(), '169.254.169.254').rule).toBe('private_network');
    expect(evaluateEgressDestination(policy({ blockIpLiterals: true }), '140.82.121.4').rule).toBe('ip_literal');
    expect(
      evaluateEgressDestination(
        policy({ blockIpLiterals: true, allowHosts: [{ value: '140.82.0.0/16', source: 'global' }] }),
        '140.82.121.4',
      ).decision,
    ).toBe('allowed');

    const withPatterns = policy({ denyUrlPatterns: [{ value: '/forbidden/', source: 'global' }] });

    expect(
      evaluateEgressDestination(withPatterns, 'example.com', { url: 'http://example.com/forbidden/x', scheme: 'http' })
        .rule,
    ).toBe('deny_url');
    // HTTPS paths are not visible to the guard without TLS interception.
    expect(
      evaluateEgressDestination(withPatterns, 'example.com', {
        url: 'https://example.com/forbidden/x',
        scheme: 'https',
      }).decision,
    ).toBe('allowed');
  });

  it('reports observed in monitor mode and blocks everything when offline', () => {
    const monitored = policy({ mode: 'monitor', denyHosts: [{ value: 'bad.example', source: 'global' }] });

    expect(evaluateEgressDestination(monitored, 'bad.example').decision).toBe('observed');
    expect(evaluateEgressDestination(policy({ mode: 'offline' }), 'github.com')).toEqual({
      decision: 'blocked',
      rule: 'offline',
      source: null,
    });
  });

  it('explains guard rules with provenance', () => {
    const resolved = policy({ denyHosts: [{ value: 'bad.example', source: 'environment' }] });

    expect(explainEgressRule(resolved, 'deny_host', 'www.bad.example')).toEqual({
      matchedEntry: 'bad.example',
      source: 'environment',
    });
    expect(explainEgressRule(resolved, null, 'x')).toEqual({});
  });
});

describe('redactEgressUrl', () => {
  it('drops query strings, fragments and credentials', () => {
    expect(redactEgressUrl('http://user:pw@example.com/path?token=abc#frag')).toBe('http://example.com/path');
    expect(redactEgressUrl(null)).toBeNull();
    expect(redactEgressUrl(`http://example.com/${'a'.repeat(600)}`, 30)).toHaveLength(30);
  });
});

describe('message filters', () => {
  const rules = resolveEffectiveMessageFilters([
    {
      source: 'environment',
      overlay: { message_filters: [{ name: 'Env flag', pattern: 'hello', action: 'flag', direction: 'incoming' }] },
    },
    {
      source: 'global',
      overlay: {
        message_filters: [
          { name: 'Mask token', pattern: 'token-\\d+', action: 'replace', replacement: '[redacted]' },
          { name: 'Disabled drop', pattern: 'hello', action: 'drop', enabled: false },
        ],
      },
    },
    {
      source: 'workspace',
      overlay: {
        message_filters: [
          { name: 'Drop secrets', pattern: 'BEGIN PRIVATE KEY', action: 'drop', direction: 'bidirectional' },
          {
            name: 'Mask mail',
            pattern: '[a-z]+@corp\\.example',
            flags: 'gi',
            action: 'replace',
            replacement: '<mail>',
          },
        ],
      },
    },
  ]);

  it('orders rules by layer precedence with provenance and defaults', () => {
    expect(rules.map((rule) => [rule.name, rule.source])).toEqual([
      ['Mask token', 'global'],
      ['Disabled drop', 'global'],
      ['Drop secrets', 'workspace'],
      ['Mask mail', 'workspace'],
      ['Env flag', 'environment'],
    ]);
    expect(rules[0]).toMatchObject({ flags: 'g', direction: 'bidirectional', enabled: true });
  });

  it('drops when any drop rule matches (most restrictive wins)', () => {
    const result = evaluateMessageFilters(rules, 'token-1 BEGIN PRIVATE KEY', 'outgoing');

    expect(result.status).toBe('dropped');
    expect(result.matchedRule?.name).toBe('Drop secrets');
    expect(result.matchedRules.map((rule) => rule.name)).toEqual(['Mask token', 'Drop secrets']);
  });

  it('chains replace rules in precedence order', () => {
    const result = evaluateMessageFilters(rules, 'token-12 from Bob@corp.example', 'incoming');

    expect(result.status).toBe('filtered');
    expect(result.matchedRule?.name).toBe('Mask token');
    expect(result.modifiedMessage).toBe('[redacted] from <mail>');
  });

  it('flags without modifying, honours direction and skips disabled rules', () => {
    expect(evaluateMessageFilters(rules, 'hello there', 'incoming')).toMatchObject({
      status: 'filtered',
      matchedRule: expect.objectContaining({ name: 'Env flag' }),
    });
    expect(evaluateMessageFilters(rules, 'hello there', 'incoming').modifiedMessage).toBeUndefined();
    expect(evaluateMessageFilters(rules, 'hello there', 'outgoing').status).toBe('allowed');
  });

  it('skips invalid stored rules instead of failing', () => {
    expect(
      resolveEffectiveMessageFilters([
        { source: 'global', overlay: { message_filters: [{ name: 'bad', pattern: '(', action: 'drop' }, 'nope'] } },
      ]),
    ).toEqual([]);
  });
});

describe('resolvePlatformSecurityPolicy / stablePlatformPolicyJson', () => {
  it('resolves both policies and serializes deterministically', () => {
    const resolved = resolvePlatformSecurityPolicy([{ source: 'global', overlay: { egress: { mode: 'monitor' } } }]);

    expect(resolved.egress.mode).toBe('monitor');
    expect(resolved.messageFilters).toEqual([]);
    expect(stablePlatformPolicyJson({ b: 1, a: [{ d: 1, c: 2 }] })).toBe('{"a":[{"c":2,"d":1}],"b":1}');
  });
});
