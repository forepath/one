import { hasAgentConfigChanges, summarizeAgentConfigChange } from './agent-config-change.utils';

describe('summarizeAgentConfigChange', () => {
  it('reports changed root keys, security roots, locks and secret keys (never values)', () => {
    const summary = summarizeAgentConfigChange(
      { config: { model: 'a/b', egress: { mode: 'off' } }, overrides: {}, locks: ['/model'] },
      {
        config: { model: 'a/b', egress: { mode: 'enforce' }, share: 'manual' },
        overrides: { message_filters: [] },
        locks: ['/model', '/tabs/egress'],
      },
      { HTTP_PROXY: 'http://proxy:8080' },
    );

    expect(summary).toEqual({
      changedRoots: ['egress', 'message_filters', 'share'],
      securityRootsChanged: ['egress', 'message_filters'],
      locksChanged: true,
      secretKeysChanged: ['HTTP_PROXY'],
    });
    expect(hasAgentConfigChanges(summary)).toBe(true);
  });

  it('ignores key order and detects no-op saves', () => {
    const summary = summarizeAgentConfigChange(
      { config: { egress: { mode: 'enforce', deny_hosts: ['a'] } }, locks: ['/b', '/a'] },
      { config: { egress: { deny_hosts: ['a'], mode: 'enforce' } }, locks: ['/a', '/b'] },
      undefined,
    );

    expect(summary.changedRoots).toEqual([]);
    expect(hasAgentConfigChanges(summary)).toBe(false);
  });

  it('flags clearing all secrets', () => {
    expect(summarizeAgentConfigChange({}, {}, null).secretKeysChanged).toEqual(['*']);
  });
});
