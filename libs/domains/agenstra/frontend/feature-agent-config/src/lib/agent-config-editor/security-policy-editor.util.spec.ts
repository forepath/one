import { resolvePlatformSecurityPolicy } from '@forepath/agenstra/shared/util-opencode-config';

import {
  draftEgressPolicy,
  draftMessageFilterRules,
  editorLayerSource,
  egressOverlay,
  messageFilterRules,
  nextMessageFilterRuleName,
  parentEgressPolicy,
  parentLayerSources,
  parseDestinationList,
  parseEgressTestInput,
  testEgressDestination,
  testMessageFilters,
} from './security-policy-editor.util';

const serverPolicy = resolvePlatformSecurityPolicy([
  { source: 'global', overlay: { egress: { mode: 'enforce', deny_hosts: ['bad.example'] } } },
  {
    source: 'workspace',
    overlay: {
      egress: { allow_hosts: ['old.example'], log_allowed: false },
      message_filters: [{ name: 'Old', pattern: 'old', action: 'drop' }],
    },
  },
]);

describe('security-policy-editor.util', () => {
  it('maps editor layers to policy sources and parents', () => {
    expect(editorLayerSource('agent')).toBe('environment');
    expect(editorLayerSource('global')).toBe('global');
    expect(parentLayerSources('global')).toEqual([]);
    expect(parentLayerSources('workspace')).toEqual(['global']);
    expect(parentLayerSources('agent')).toEqual(['global', 'workspace']);
  });

  it('removes the own layer from the server policy to obtain the parent policy', () => {
    const parent = parentEgressPolicy(serverPolicy, 'workspace');

    expect(parent.mode).toBe('enforce');
    expect(parent.allowHosts).toEqual([]);
    expect(parent.logAllowed).toBe(true);
    expect(parent.scalarSources.logAllowed).toBeNull();
    expect(parent.denyHosts).toEqual([{ value: 'bad.example', source: 'global' }]);
  });

  it('combines parent policy and the unsaved draft (parent scalars win)', () => {
    const policy = draftEgressPolicy(serverPolicy, 'workspace', {
      egress: { mode: 'off', allow_hosts: ['github.com'], block_ip_literals: true },
    });

    expect(policy.mode).toBe('enforce');
    expect(policy.scalarSources.mode).toBe('global');
    expect(policy.blockIpLiterals).toBe(true);
    expect(policy.scalarSources.blockIpLiterals).toBe('workspace');
    expect(policy.allowHosts).toEqual([{ value: 'github.com', source: 'workspace' }]);

    expect(testEgressDestination(policy, 'https://x.bad.example/path')).toEqual(
      expect.objectContaining({ host: 'x.bad.example', decision: 'blocked', rule: 'deny_host', source: 'global' }),
    );
    expect(testEgressDestination(policy, 'gitlab.com:443')).toEqual(
      expect.objectContaining({ host: 'gitlab.com', decision: 'blocked', rule: 'not_allowlisted' }),
    );
    expect(testEgressDestination(policy, 'api.github.com')?.decision).toBe('allowed');
    expect(testEgressDestination(policy, '   ')).toBeNull();
  });

  it('parses tester input', () => {
    expect(parseEgressTestInput('http://Example.com/a?b=1')).toEqual({
      host: 'example.com',
      url: 'http://example.com/a',
      scheme: 'http',
    });
    expect(parseEgressTestInput('[::1]:8080')).toEqual({ host: '::1' });
    expect(parseEgressTestInput('http://')).toBeNull();
  });

  it('evaluates inherited and draft message filter rules together', () => {
    const rules = draftMessageFilterRules(serverPolicy, 'agent', {
      message_filters: [{ name: 'Mask', pattern: 'secret', action: 'replace', replacement: '***' }],
    });

    expect(rules.map((rule) => [rule.name, rule.source])).toEqual([
      ['Old', 'workspace'],
      ['Mask', 'environment'],
    ]);
    expect(testMessageFilters(rules, 'my secret', 'incoming')).toEqual(
      expect.objectContaining({ status: 'filtered', modifiedMessage: 'my ***' }),
    );
    expect(testMessageFilters(rules, 'old secret', 'outgoing').status).toBe('dropped');
  });

  it('provides overlay readers and helpers', () => {
    expect(egressOverlay({ egress: { mode: 'off' } })).toEqual({ mode: 'off' });
    expect(egressOverlay({ egress: [] })).toEqual({});
    expect(messageFilterRules({ message_filters: [{ name: 'a' }, 'x'] })).toEqual([{ name: 'a' }]);
    expect(parseDestinationList('10.0.0.1, 10.0.0.2\n\n192.168.0.0/16')).toEqual([
      '10.0.0.1',
      '10.0.0.2',
      '192.168.0.0/16',
    ]);
    expect(nextMessageFilterRuleName([{ name: 'Rule 2' }])).toBe('Rule 3');
    expect(nextMessageFilterRuleName([{ name: 'Rule 2' }, { name: 'Rule 3' }])).toBe('Rule 4');
  });
});
