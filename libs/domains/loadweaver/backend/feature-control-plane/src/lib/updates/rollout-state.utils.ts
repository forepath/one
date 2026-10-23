import type { GateResult, GateState } from './rollout-gates.utils';
import type { RolloutStepState, StepData, StepTarget } from './rollout.entity';

/**
 * The resumable state machine of one update step (3.26). Pure: given the step as stored and what the controller
 * observed, it returns the next state, the data to remember and the effects to carry out. Everything lives in the
 * database, so any control-plane replica can continue a step after the previous leader died — including the replica
 * that just replaced itself with the new version.
 *
 *   pending → waiting-window ⇄ pending
 *   components: pending → applying → verifying → done
 *   host:       pending → draining → applying → rebooting → verifying → done   (rebooting only when needed)
 *   failures:   … → failed → rolling-back → rolled-back | rollback-failed
 */

export type StepEffect =
  | { kind: 'set-target'; target: StepTarget | null }
  | { kind: 'drain' }
  /** Gives the node back: `active`, or `cordoned` if an operator had cordoned it before the step. */
  | { kind: 'uncordon'; lifecycle: 'active' | 'cordoned' }
  | { kind: 'pause'; reason: string };

export interface StepRow {
  state: RolloutStepState;
  kind: 'components' | 'host';
  target: StepTarget;
  before: StepTarget | null;
  data: StepData;
  stateChangedAt: number;
  startedAt: number | null;
}

export interface StepObservation {
  now: number;
  /** Window open for this node (or windows ignored). */
  windowOpen: boolean;
  /** The rollout may start new steps (not pause-requested). */
  mayStart: boolean;
  /** The node has no replicas left (drain finished). */
  drained: boolean;
  /** The node's lifecycle now (to restore after the step). */
  lifecycle: string;
  bootId: string | undefined;
  /** Host action progress for this step's id, as the agent reports it. */
  hostAction: { phase: string; error?: string } | null;
  rebootRequired: boolean;
  /** Patroni switchover needed before this member updates: the candidate's address. */
  switchoverCandidate: string | null;
  /**
   * The member is the Patroni leader right now but no updated replica can take over: the step must not start (nor
   * leave its drain) — applying in place would update the leader's database without a switchover.
   */
  switchoverHold?: string | null;
  gates: { state: GateState; gates: GateResult[] };
  /** Gates of a rollback: only that the node is back with the previous release. */
  rollbackGates: { state: GateState; gates: GateResult[] };
  settleMs: number;
  timeoutMs: number;
  drainTimeoutMs: number;
  newId: () => string;
}

export interface StepAdvance {
  state: RolloutStepState;
  data: StepData;
  effects: StepEffect[];
  error?: string | null;
  /** Set when the step (re)started. */
  started?: boolean;
  finished?: boolean;
}

/** The node returns to the lifecycle it had when this step drained it. */
function giveBack(data: StepData): StepEffect[] {
  return data.drained && data.previousLifecycle !== 'draining'
    ? [{ kind: 'uncordon', lifecycle: data.previousLifecycle === 'cordoned' ? 'cordoned' : 'active' }]
    : [];
}

function failure(data: StepData, reason: string): StepAdvance {
  return { state: 'failed', data, effects: [{ kind: 'pause', reason }], error: reason };
}

function summarize(gates: GateResult[], state: GateState): string {
  return gates
    .filter((g) => g.state === state)
    .map((g) => g.message)
    .join('; ');
}

/** The target that applies the step's release (and host update / switchover). */
function applyTarget(row: StepRow, data: StepData, obs: StepObservation): StepTarget {
  return {
    release: row.target.release,
    ...(row.target.host ? { host: { ...row.target.host } } : {}),
    ...(data.switchoverId && obs.switchoverCandidate
      ? { actions: { patroniSwitchover: { id: data.switchoverId, candidate: obs.switchoverCandidate } } }
      : {}),
  };
}

export function advanceStep(row: StepRow, obs: StepObservation): StepAdvance {
  const inState = obs.now - row.stateChangedAt;
  const data = { ...row.data };

  switch (row.state) {
    case 'pending':
    case 'waiting-window': {
      if (!obs.mayStart) return { state: row.state, data, effects: [] };

      if (!obs.windowOpen) return { state: 'waiting-window', data, effects: [] };

      if (obs.switchoverHold) return { state: row.state, data, effects: [], error: obs.switchoverHold };

      data.bootId = obs.bootId;

      if (row.kind === 'host') {
        data.drained = obs.lifecycle !== 'draining';
        data.previousLifecycle = obs.lifecycle;

        return {
          state: 'draining',
          data,
          effects: data.drained ? [{ kind: 'drain' }] : [],
          error: null,
          started: true,
        };
      }

      if (obs.switchoverCandidate) data.switchoverId = obs.newId();

      return {
        state: 'applying',
        data,
        effects: [{ kind: 'set-target', target: applyTarget(row, data, obs) }],
        error: null,
        started: true,
      };
    }

    case 'draining': {
      if (obs.drained && !obs.switchoverHold) {
        if (obs.switchoverCandidate) data.switchoverId = obs.newId();

        data.hostApplied = true;

        return { state: 'applying', data, effects: [{ kind: 'set-target', target: applyTarget(row, data, obs) }] };
      }

      if (inState > obs.drainTimeoutMs) return failure(data, 'the drain did not finish in time');

      return { state: 'draining', data, effects: [] };
    }

    case 'applying': {
      if (row.kind === 'host' && row.target.host) {
        const action = obs.hostAction;

        if (action?.phase === 'failed' || action?.phase === 'rolled-back')
          return failure(data, `host update failed: ${action.error ?? 'no details'}`);

        if (action?.phase !== 'done') {
          if (inState > obs.timeoutMs) return failure(data, 'the host update did not finish in time');

          return { state: 'applying', data, effects: [] };
        }

        if (obs.rebootRequired) {
          data.rebootToken = obs.newId();
          data.bootId = obs.bootId;

          return {
            state: 'rebooting',
            data,
            effects: [
              {
                kind: 'set-target',
                target: {
                  ...applyTarget(row, data, obs),
                  host: { ...row.target.host, reboot: data.rebootToken },
                },
              },
            ],
          };
        }
      }

      return { state: 'verifying', data, effects: [] };
    }

    case 'rebooting': {
      if (obs.bootId && obs.bootId !== data.bootId) return { state: 'verifying', data, effects: [] };

      if (inState > obs.timeoutMs) return failure(data, 'the node did not come back after its reboot');

      return { state: 'rebooting', data, effects: [] };
    }

    case 'verifying': {
      data.gates = obs.gates.gates.map((g) => ({ name: g.name, ok: g.state === 'pass', message: g.message }));

      if (obs.gates.state === 'fail') return failure(data, summarize(obs.gates.gates, 'fail'));

      if (obs.gates.state === 'wait') {
        delete data.settledSince;

        if (inState > obs.timeoutMs)
          return failure(data, `health gates not met in time: ${summarize(obs.gates.gates, 'wait')}`);

        return { state: 'verifying', data, effects: [] };
      }

      data.settledSince ??= new Date(obs.now).toISOString();

      if (obs.now - Date.parse(data.settledSince) < obs.settleMs) return { state: 'verifying', data, effects: [] };

      return {
        state: 'done',
        data,
        effects: giveBack(data),
        finished: true,
      };
    }

    case 'failed': {
      // Automatic rollback of this step (same semantics as applies, 3.19).
      return startRollback(row, data);
    }

    case 'rolling-back': {
      if (obs.rollbackGates.state === 'pass')
        return { state: 'rolled-back', data, effects: giveBack(data), finished: true };

      if (inState > obs.timeoutMs)
        return {
          state: 'rollback-failed',
          data,
          effects: [],
          error: `rollback not confirmed: ${summarize(obs.rollbackGates.gates, 'wait') || 'no report'}`,
          finished: true,
        };

      return { state: 'rolling-back', data, effects: [] };
    }

    default:
      return { state: row.state, data, effects: [] };
  }
}

/** Steps that changed a node and haven't finished: the rollout can't simply be cancelled while they exist. */
export const IN_FLIGHT_STEP_STATES: readonly RolloutStepState[] = [
  'draining',
  'switchover',
  'applying',
  'rebooting',
  'verifying',
  'failed',
  'rolling-back',
];

export interface SwitchoverMember {
  name: string;
  witness: boolean;
  postgres?: string;
  /** This rollout's step on the member is done. */
  updated: boolean;
  /** Index of that step in the rollout: the earliest updated replica is the candidate (deterministic). */
  order?: number;
}

export type SwitchoverDecision =
  | { kind: 'none' }
  | { kind: 'switchover'; candidate: string }
  /** Run the step of `node` (a replica not updated yet) first: it becomes the updated replica to hand over to. */
  | { kind: 'reorder'; node: string; reason: string }
  | { kind: 'hold'; reason: string };

/**
 * What a member step needs before it may start, decided on the roles *now* (the plan ordered members by their roles
 * at plan time, and the leader may have moved since): the current Patroni leader switches over to an updated replica;
 * without one, a replica whose step hasn't started runs first; with neither, the step waits. A cluster with a single
 * Postgres member updates in place (nothing to hand over to).
 */
export function switchoverDecision(
  node: string,
  members: readonly SwitchoverMember[],
  notStarted: readonly string[],
): SwitchoverDecision {
  const self = members.find((m) => m.name === node);

  if (!self || self.witness || self.postgres !== 'leader') return { kind: 'none' };

  const others = members.filter((m) => !m.witness && m.name !== node);
  const candidate = others
    .filter((m) => m.postgres === 'replica' && m.updated)
    .sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER))[0];

  if (candidate) return { kind: 'switchover', candidate: candidate.name };

  if (others.length === 0) return { kind: 'none' };

  const next = notStarted.find((n) => others.some((m) => m.name === n && m.postgres === 'replica'));

  if (next)
    return {
      kind: 'reorder',
      node: next,
      reason: `${node} is the Postgres leader and no replica is updated yet: ${next} goes first`,
    };

  return {
    kind: 'hold',
    reason: `${node} is the Postgres leader and no updated replica can take over yet; waiting (not updating the leader in place)`,
  };
}

/**
 * Starts the rollback of a step: the node goes back to the components it had. Host updates (packages, kernel) can't
 * be undone automatically once the node installed them: such a step ends `rollback-failed` with the node's real
 * state shown, and a new update plan fixes forward. A host step that failed before anything was installed (drain
 * timeout) just gives the node back.
 */
export function startRollback(row: StepRow, data: StepData): StepAdvance {
  const uncordon = giveBack(data);

  if (row.kind === 'host' && !data.hostApplied)
    return { state: 'rolled-back', data, effects: uncordon, finished: true };

  if (row.kind === 'host')
    return {
      state: 'rollback-failed',
      data,
      effects: [
        { kind: 'set-target', target: row.before?.release ? { release: row.before.release } : null },
        ...uncordon,
      ],
      error:
        'host packages / kernel may have been installed on the node; they are not rolled back automatically (its real versions are shown; fix forward with a new update plan)',
      finished: true,
    };

  if (!row.before?.release)
    return {
      state: 'rollback-failed',
      data,
      effects: [{ kind: 'set-target', target: null }, ...uncordon],
      error:
        'no earlier imported release to return to; the node keeps what it runs (fix forward with a new update plan)',
      finished: true,
    };

  return { state: 'rolling-back', data, effects: [{ kind: 'set-target', target: { release: row.before.release } }] };
}
