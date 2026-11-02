import {
  compare,
  deniesSpiking,
  seriesChange,
  shouldEscalate,
  silenced,
  transition,
  type AlertFinding,
  type OpenAlert,
} from './alert-rules.utils';

const now = Date.parse('2026-10-18T12:00:00Z');
const finding = (over: Partial<AlertFinding> = {}): AlertFinding => ({
  rule: 'builtin:node-down',
  key: 'n1',
  severity: 'critical',
  title: 't',
  message: 'm',
  forMs: 60_000,
  repeatMs: 3_600_000,
  notify: { emails: [], webhooks: true },
  ...over,
});
const open = (over: Partial<OpenAlert> = {}): OpenAlert => ({
  state: 'firing',
  startedAt: new Date(now - 600_000),
  notifiedAt: new Date(now - 60_000),
  acknowledgedAt: null,
  silenced: false,
  ...over,
});

describe('alert transitions', () => {
  it('pends a new finding with a `for`, fires one without', () => {
    expect(transition(undefined, finding(), now)).toBe('pend');
    expect(transition(undefined, finding({ forMs: 0 }), now)).toBe('fire');
  });

  it('fires a pending alert once its `for` passed', () => {
    expect(transition(open({ state: 'pending', startedAt: new Date(now - 30_000) }), finding(), now)).toBe('none');
    expect(transition(open({ state: 'pending', startedAt: new Date(now - 60_000) }), finding(), now)).toBe('fire');
  });

  it('resolves when the finding is gone, and does nothing without either', () => {
    expect(transition(open(), undefined, now)).toBe('resolve');
    expect(transition(open({ state: 'pending' }), undefined, now)).toBe('resolve');
    expect(transition(undefined, undefined, now)).toBe('none');
  });

  it('repeats unacknowledged, unsilenced alerts every repeatEvery', () => {
    expect(transition(open(), finding(), now)).toBe('none');
    expect(transition(open({ notifiedAt: new Date(now - 3_600_000) }), finding(), now)).toBe('notify');
    expect(
      transition(open({ notifiedAt: new Date(now - 3_600_000), acknowledgedAt: new Date() }), finding(), now),
    ).toBe('none');
    expect(transition(open({ notifiedAt: new Date(now - 3_600_000), silenced: true }), finding(), now)).toBe('none');
  });

  it('notifies a firing alert that was silenced when it fired once the silence ends', () => {
    expect(transition(open({ notifiedAt: null }), finding(), now)).toBe('notify');
    expect(transition(open({ notifiedAt: null, silenced: true }), finding(), now)).toBe('none');
  });
});

describe('escalation', () => {
  const escalating = finding({ escalate: { afterMs: 1_800_000, emails: ['oncall@example.com'] } });
  const firing = { ...open(), firedAt: new Date(now - 1_800_000), escalatedAt: null };

  it('escalates once after the delay, unless acknowledged or silenced', () => {
    expect(shouldEscalate(firing, escalating, now)).toBe(true);
    expect(shouldEscalate({ ...firing, firedAt: new Date(now - 60_000) }, escalating, now)).toBe(false);
    expect(shouldEscalate({ ...firing, escalatedAt: new Date(now) }, escalating, now)).toBe(false);
    expect(shouldEscalate({ ...firing, acknowledgedAt: new Date(now) }, escalating, now)).toBe(false);
    expect(shouldEscalate({ ...firing, silenced: true }, escalating, now)).toBe(false);
    expect(shouldEscalate(firing, finding(), now)).toBe(false);
  });
});

describe('silences', () => {
  const window = { startsAt: new Date(now - 1), endsAt: new Date(now + 60_000) };

  it('matches every field a silence sets, rules by name or prefix', () => {
    const alert = { rule: 'builtin:node-down', key: 'n1', project: null };

    expect(silenced([{ rule: 'builtin:node-down', project: null, key: null, ...window }], alert, now)).toBe(true);
    expect(silenced([{ rule: 'builtin:*', project: null, key: 'n1', ...window }], alert, now)).toBe(true);
    expect(silenced([{ rule: 'builtin:*', project: null, key: 'n2', ...window }], alert, now)).toBe(false);
    expect(silenced([{ rule: null, project: 'shop', key: null, ...window }], alert, now)).toBe(false);
    expect(silenced([{ rule: null, project: 'shop', key: null, ...window }], { ...alert, project: 'shop' }, now)).toBe(
      true,
    );
  });

  it('only while active', () => {
    const alert = { rule: 'builtin:node-down', key: 'n1' };

    expect(
      silenced(
        [{ rule: null, project: null, key: 'n1', startsAt: new Date(now + 1), endsAt: new Date(now + 60_000) }],
        alert,
        now,
      ),
    ).toBe(false);
    expect(
      silenced([{ rule: null, project: null, key: 'n1', startsAt: new Date(0), endsAt: new Date(now) }], alert, now),
    ).toBe(false);
  });
});

describe('helpers', () => {
  it('compares', () => {
    expect(compare('>', 2, 1)).toBe(true);
    expect(compare('>=', 1, 1)).toBe(true);
    expect(compare('<', 1, 1)).toBe(false);
    expect(compare('<=', 1, 1)).toBe(true);
  });

  it('spots spiking denies only above the floor and well above the baseline', () => {
    expect(deniesSpiking(500, 0)).toBe(false);
    expect(deniesSpiking(5_000, 100)).toBe(true);
    expect(deniesSpiking(5_000, 1_000)).toBe(false);
  });

  it('changes need two points', () => {
    expect(seriesChange([1])).toBeNull();
    expect(seriesChange([1, 5, 3])).toBe(2);
  });
});
