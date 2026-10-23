import { groupDiff, progressPercent, rolloutActions, windowSchedule, windowScope, windowTone } from './update-format';

describe('update format', () => {
  it('offers the actions the API accepts per status', () => {
    expect(rolloutActions('planned')).toEqual(['approve', 'cancel']);
    expect(rolloutActions('approved')).toEqual(['pause', 'rollback', 'cancel']);
    expect(rolloutActions('running')).toEqual(['pause', 'rollback']);
    expect(rolloutActions('paused')).toEqual(['resume', 'rollback', 'cancel']);
    expect(rolloutActions('completed')).toEqual([]);
    expect(rolloutActions('rollback-failed')).toEqual([]);
  });

  it('describes windows', () => {
    expect(windowSchedule({ days: ['thu', 'tue'], start: '02:00', end: '05:00', timeZone: 'Europe/Berlin' })).toBe(
      'Tue, Thu 02:00–05:00 (Europe/Berlin)',
    );
    expect(windowScope({})).toBe('all nodes');
    expect(
      windowScope({
        sites: ['fra1'],
        selector: { matchLabels: { tier: 'edge' }, matchExpressions: [{ key: 'gpu', operator: 'Exists' }] },
      }),
    ).toBe('sites fra1 · tier=edge · gpu Exists');
    expect(windowTone({ open: true, opensAt: null, closesAt: null, windows: ['w'] })).toBe('success');
    expect(windowTone({ open: false, opensAt: '2026-10-20T02:00:00Z', closesAt: null, windows: ['w'] })).toBe('info');
    expect(windowTone({ open: false, opensAt: null, closesAt: null, windows: [] })).toBe('secondary');
  });

  it('groups the diff per node or component', () => {
    const diff = [
      { node: 'n2', component: 'envoy', from: '1.30', to: '1.31', method: 'hot restart' },
      { node: 'n1', component: 'node-agent', from: '1.1.0', to: '1.2.0', method: 'binary swap' },
      { node: 'n1', component: 'envoy', from: '1.30', to: '1.31', method: 'hot restart' },
    ];

    expect(groupDiff(diff, 'node').map((g) => [g.key, g.entries.map((e) => e.component)])).toEqual([
      ['n1', ['envoy', 'node-agent']],
      ['n2', ['envoy']],
    ]);
    expect(groupDiff(diff, 'component').map((g) => [g.key, g.entries.map((e) => e.node)])).toEqual([
      ['envoy', ['n1', 'n2']],
      ['node-agent', ['n1']],
    ]);
  });

  it('computes progress', () => {
    expect(progressPercent({ progress: { done: 1, total: 3, currentWave: 1 } })).toBe(33);
    expect(progressPercent({ progress: { done: 0, total: 0, currentWave: null } })).toBe(0);
  });
});
