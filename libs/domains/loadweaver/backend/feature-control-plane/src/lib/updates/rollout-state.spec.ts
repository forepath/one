import type { GateState } from './rollout-gates.utils';
import {
  advanceStep,
  startRollback,
  switchoverDecision,
  type StepObservation,
  type StepRow,
} from './rollout-state.utils';

const PASS = { state: 'pass' as GateState, gates: [{ name: 'version', state: 'pass' as GateState, message: 'ok' }] };
const WAIT = {
  state: 'wait' as GateState,
  gates: [{ name: 'version', state: 'wait' as GateState, message: 'waiting' }],
};
const FAIL = {
  state: 'fail' as GateState,
  gates: [{ name: 'health', state: 'fail' as GateState, message: 'web failed' }],
};

let ids = 0;
const obs = (over: Partial<StepObservation> = {}): StepObservation => ({
  now: 1_000_000,
  windowOpen: true,
  mayStart: true,
  drained: false,
  lifecycle: 'active',
  bootId: 'boot-1',
  hostAction: null,
  rebootRequired: false,
  switchoverCandidate: null,
  gates: PASS,
  rollbackGates: PASS,
  settleMs: 60_000,
  timeoutMs: 600_000,
  drainTimeoutMs: 300_000,
  newId: () => `id-${++ids}`,
  ...over,
});

const row = (over: Partial<StepRow> = {}): StepRow => ({
  state: 'pending',
  kind: 'components',
  target: { release: '3.5.0' },
  before: { release: '3.4.0' },
  data: {},
  stateChangedAt: 1_000_000,
  startedAt: null,
  ...over,
});

/** Runs a step through observations, persisting like the controller does. */
function run(start: StepRow, observations: Partial<StepObservation>[]) {
  let current = start;
  const trail: string[] = [];
  const effects: unknown[] = [];

  for (const o of observations) {
    const next = advanceStep(current, obs(o));

    effects.push(...next.effects);
    current = {
      ...current,
      state: next.state,
      data: next.data,
      stateChangedAt: next.state !== current.state ? (o.now ?? 1_000_000) : current.stateChangedAt,
    };
    trail.push(current.state);
  }

  return { step: current, trail, effects };
}

describe('update step state machine (3.26)', () => {
  it('runs a components step: apply → verify → settle → done', () => {
    const { trail, effects } = run(row(), [{}, {}, { now: 1_000_000 }, { now: 1_070_000 }]);

    expect(trail).toEqual(['applying', 'verifying', 'verifying', 'done']);
    expect(effects).toEqual([{ kind: 'set-target', target: { release: '3.5.0' } }]);
  });

  it('waits for the maintenance window and for the rollout to allow new steps', () => {
    expect(advanceStep(row(), obs({ windowOpen: false })).state).toBe('waiting-window');
    expect(advanceStep(row({ state: 'waiting-window' }), obs({ windowOpen: true })).state).toBe('applying');
    expect(advanceStep(row(), obs({ mayStart: false })).state).toBe('pending');
  });

  it('switches Patroni over before the leader member updates', () => {
    const next = advanceStep(row(), obs({ switchoverCandidate: '10.93.0.2' }));

    expect(next.effects).toEqual([
      {
        kind: 'set-target',
        target: {
          release: '3.5.0',
          actions: { patroniSwitchover: { id: next.data.switchoverId, candidate: '10.93.0.2' } },
        },
      },
    ]);
  });

  it('re-decides the switchover on the current roles: hand over, run a replica first, or wait (M6 review M2)', () => {
    const members = (leader: string, updated: string[] = []) =>
      ['m1', 'm2', 'm3', 'w1'].map((name) => ({
        name,
        witness: name === 'w1',
        ...(name === 'w1' ? {} : { postgres: name === leader ? 'leader' : 'replica' }),
        updated: updated.includes(name),
      }));

    // Not the leader (any more): no switchover.
    expect(switchoverDecision('m1', members('m3'), [])).toEqual({ kind: 'none' });
    // The leader with an updated replica hands over to it.
    expect(switchoverDecision('m1', members('m1', ['m2']), ['m3'])).toEqual({ kind: 'switchover', candidate: 'm2' });
    // Several updated replicas: the one updated first takes over, whatever order the nodes are read in.
    const both = members('m1', ['m2', 'm3']).map((m) => ({ ...m, order: m.name === 'm3' ? 0 : 1 }));

    expect(switchoverDecision('m1', both, [])).toEqual({ kind: 'switchover', candidate: 'm3' });
    expect(switchoverDecision('m1', [...both].reverse(), [])).toEqual({ kind: 'switchover', candidate: 'm3' });
    // The plan ordered m1 first (a replica at plan time), but m1 leads now and nobody is updated: m2 goes first.
    expect(switchoverDecision('m1', members('m1'), ['m2', 'm3'])).toMatchObject({ kind: 'reorder', node: 'm2' });
    // Nothing to reorder with (the others are done but not replicas, e.g. still restarting): wait.
    const restarting = members('m1', ['m2', 'm3']).map((m) =>
      m.name === 'm1' || m.witness ? m : { ...m, postgres: 'unknown' },
    );

    expect(switchoverDecision('m1', restarting, [])).toMatchObject({ kind: 'hold' });
    // A single Postgres member updates in place.
    expect(switchoverDecision('m1', [{ name: 'm1', witness: false, postgres: 'leader', updated: false }], [])).toEqual({
      kind: 'none',
    });
  });

  it('holds a leader step without a candidate instead of applying it in place', () => {
    const held = advanceStep(row(), obs({ switchoverHold: 'no updated replica' }));

    expect(held).toMatchObject({ state: 'pending', effects: [], error: 'no updated replica' });

    // A host step keeps draining (until its drain timeout) instead of applying.
    const draining = row({
      state: 'draining',
      kind: 'host',
      target: { release: '3.5.0', host: { id: 'h1', snapshot: 's1', upgrade: true } },
    });

    expect(advanceStep(draining, obs({ drained: true, switchoverHold: 'x' })).state).toBe('draining');
    // Started later: the hold message is cleared.
    expect(advanceStep(row(), obs({ switchoverCandidate: '10.93.0.2' }))).toMatchObject({
      state: 'applying',
      error: null,
    });
  });

  it('runs a host step: drain → apply → reboot → verify → uncordon', () => {
    const host = row({ kind: 'host', target: { release: '3.5.0', host: { id: 'h1', snapshot: 's1', upgrade: true } } });
    const { step, trail, effects } = run(host, [
      {},
      { drained: false },
      { drained: true },
      { hostAction: { phase: 'installing' } },
      { hostAction: { phase: 'done' }, rebootRequired: true },
      { bootId: 'boot-1' },
      { bootId: 'boot-2' },
      { bootId: 'boot-2', now: 1_000_000 },
      { bootId: 'boot-2', now: 1_100_000 },
    ]);

    expect(trail).toEqual([
      'draining',
      'draining',
      'applying',
      'applying',
      'rebooting',
      'rebooting',
      'verifying',
      'verifying',
      'done',
    ]);
    expect(effects[0]).toEqual({ kind: 'drain' });
    expect(effects).toContainEqual({
      kind: 'set-target',
      target: { release: '3.5.0', host: { id: 'h1', snapshot: 's1', upgrade: true, reboot: step.data.rebootToken } },
    });
    expect(effects[effects.length - 1]).toEqual({ kind: 'uncordon', lifecycle: 'active' });
  });

  it('skips the reboot when nothing needs one', () => {
    const host = row({
      kind: 'host',
      state: 'applying',
      target: { release: '3.5.0', host: { id: 'h1', snapshot: 's1', upgrade: false } },
    });

    expect(advanceStep(host, obs({ hostAction: { phase: 'done' } })).state).toBe('verifying');
  });

  it('fails on a failing gate, pauses the rollout and rolls the step back', () => {
    const failed = advanceStep(row({ state: 'verifying' }), obs({ gates: FAIL }));

    expect(failed).toMatchObject({ state: 'failed', effects: [{ kind: 'pause', reason: 'web failed' }] });

    const rolling = advanceStep(row({ state: 'failed' }), obs());

    expect(rolling).toMatchObject({
      state: 'rolling-back',
      effects: [{ kind: 'set-target', target: { release: '3.4.0' } }],
    });
    expect(advanceStep(row({ state: 'rolling-back' }), obs({ rollbackGates: PASS })).state).toBe('rolled-back');
    expect(
      advanceStep(row({ state: 'rolling-back', stateChangedAt: 0 }), obs({ rollbackGates: WAIT, now: 700_000 })),
    ).toMatchObject({ state: 'rollback-failed', error: expect.stringContaining('waiting') });
  });

  it('times out steps that never become healthy, and drains that never finish', () => {
    expect(advanceStep(row({ state: 'verifying', stateChangedAt: 0 }), obs({ gates: WAIT, now: 700_000 })).state).toBe(
      'failed',
    );
    expect(advanceStep(row({ state: 'verifying', stateChangedAt: 0 }), obs({ gates: WAIT, now: 100_000 })).state).toBe(
      'verifying',
    );
    expect(advanceStep(row({ kind: 'host', state: 'draining', stateChangedAt: 0 }), obs({ now: 400_000 })).state).toBe(
      'failed',
    );
    expect(
      advanceStep(
        row({ kind: 'host', state: 'rebooting', stateChangedAt: 0, data: { bootId: 'b' } }),
        obs({ bootId: 'b', now: 700_000 }),
      ).state,
    ).toBe('failed');
  });

  it('resets the settle time when gates waver', () => {
    const settling = row({ state: 'verifying', data: { settledSince: new Date(1_000_000).toISOString() } });
    const wavered = advanceStep(settling, obs({ gates: WAIT, now: 1_050_000 }));

    expect(wavered.data.settledSince).toBeUndefined();
    expect(advanceStep({ ...settling, data: wavered.data }, obs({ now: 1_070_000 })).state).toBe('verifying');
  });

  it('rolls back honestly: host packages and missing baselines end rollback-failed with the real state', () => {
    expect(
      startRollback(row({ kind: 'host', state: 'failed' }), { drained: true, previousLifecycle: 'active' }),
    ).toEqual({
      state: 'rolled-back',
      data: { drained: true, previousLifecycle: 'active' },
      effects: [{ kind: 'uncordon', lifecycle: 'active' }],
      finished: true,
    });
    // A node an operator had cordoned stays cordoned afterwards.
    expect(
      startRollback(row({ kind: 'host', state: 'failed' }), { drained: true, previousLifecycle: 'cordoned' }).effects,
    ).toEqual([{ kind: 'uncordon', lifecycle: 'cordoned' }]);
    expect(
      startRollback(row({ kind: 'host', state: 'failed' }), {
        drained: true,
        previousLifecycle: 'active',
        hostApplied: true,
      }),
    ).toMatchObject({ state: 'rollback-failed', error: expect.stringContaining('not rolled back automatically') });
    expect(startRollback(row({ before: { release: null } }), {})).toMatchObject({
      state: 'rollback-failed',
      effects: [{ kind: 'set-target', target: null }],
    });
  });

  it('resumes from the stored state after a leader change (same observations, same decision)', () => {
    const stored = row({ state: 'verifying', data: { settledSince: new Date(900_000).toISOString() } });

    // A new leader sees the stored settle time and finishes without re-applying anything.
    expect(advanceStep(stored, obs({ now: 1_000_000 }))).toMatchObject({ state: 'done', effects: [] });
    // A step that was applying keeps applying (no second set-target).
    expect(advanceStep(row({ state: 'applying' }), obs()).effects).toEqual([]);
  });
});
