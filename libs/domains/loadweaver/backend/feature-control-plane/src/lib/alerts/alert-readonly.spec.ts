import type { AlertFinding } from './alert-rules.utils';
import { liveAlertRows, type AlertRow } from './alert.service';

const now = new Date('2026-10-31T09:00:00Z');
const earlier = new Date('2026-10-30T14:00:00Z');
const row = (rule: string, key: string, over: Partial<AlertRow> = {}): AlertRow => ({
  id: `${rule}/${key}`,
  rule,
  key,
  project: null,
  severity: 'warning',
  state: 'firing',
  title: 't',
  message: 'old',
  value: null,
  started_at: earlier,
  fired_at: earlier,
  resolved_at: null,
  notified_at: earlier,
  escalated_at: null,
  silenced: false,
  acknowledged_by: null,
  acknowledged_at: null,
  ...over,
});
const finding = (rule: string, key: string, over: Partial<AlertFinding> = {}): AlertFinding => ({
  rule,
  key,
  severity: 'critical',
  title: `${rule} ${key}`,
  message: 'now',
  forMs: 0,
  repeatMs: 0,
  notify: { emails: [], webhooks: false },
  ...over,
});

describe('alerts while the control plane is read-only (3.43 fallback)', () => {
  const ctx = (evaluated: string[]) => ({
    evaluated: new Set(evaluated),
    existingRules: new Set<string>(),
    quiet: () => false,
    now,
  });

  it('resolves gone findings (an offline node’s load alert) and fires node-down', () => {
    const rows = liveAlertRows(
      [row('builtin:capacity', 'n1/cpu'), row('builtin:cluster-at-risk', 'cluster')],
      [finding('builtin:node-down', 'n1'), finding('builtin:cluster-at-risk', 'cluster', { message: 'quorum lost' })],
      ctx(['builtin:capacity', 'builtin:node-down', 'builtin:cluster-at-risk']),
    );

    expect(rows.map((r) => [r.rule, r.key, r.state, r.message])).toEqual([
      ['builtin:node-down', 'n1', 'firing', 'now'],
      ['builtin:cluster-at-risk', 'cluster', 'firing', 'quorum lost'],
    ]);
    expect(rows[0].id).toBe('live:builtin:node-down:n1');
    expect(rows[0].started_at).toBe(now);
    // An open alert keeps its start.
    expect(rows[1].started_at).toBe(earlier);
  });

  it('keeps the alerts of a rule that failed this round, and pends findings with a for-duration', () => {
    const rows = liveAlertRows(
      [row('builtin:dns-drift', 'zone')],
      [finding('builtin:slo-burn', 's1', { forMs: 300_000 })],
      ctx(['builtin:slo-burn']),
    );

    expect(rows.map((r) => [r.rule, r.state])).toEqual([
      ['builtin:dns-drift', 'firing'],
      ['builtin:slo-burn', 'pending'],
    ]);
  });
});
