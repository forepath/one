import type { ComponentVersions } from '@forepath/loadweaver/shared/util-agent-protocol';

/**
 * Health gates of an update step (3.26): the node is back with the new version, nothing got worse in the health tree
 * (3.25), no SLO started burning, replication caught up and — for control-plane members — the quorum is intact.
 * `wait` keeps the step verifying (until its timeout), `fail` fails it at once (automatic pause + rollback).
 */

export type GateState = 'pass' | 'wait' | 'fail';

export interface GateResult {
  name: string;
  state: GateState;
  message: string;
}

export interface GateBaseline {
  /** Entity keys that were failed / at-risk before the step. */
  unhealthy: string[];
  /** SLO keys (`project/deployment/service`) burning or exhausted before the step. */
  burning: string[];
}

export interface GateInput {
  now: number;
  heartbeatTimeoutMs: number;
  step: {
    node: string;
    kind: 'components' | 'host';
    /** The release the node must report (null: the step only restores / keeps what runs). */
    release: string | null;
    /** Agent version the release ships (the node must reconnect with it). */
    agentVersion: string | null;
    /** Action ids issued by this step (failed reports fail the step). */
    actionIds: string[];
    /** Boot id before the reboot, when one was ordered. */
    bootIdBefore?: string;
    baseline: GateBaseline;
    member: boolean;
    /** The member is an etcd-only witness (no Postgres, no API). */
    witness?: boolean;
    /** When the step started (ms): release-keyed actions recorded before belong to an earlier attempt. */
    startedAt?: number | null;
    /**
     * Desired-state revision carrying the step's release that the node must have applied; null: its desired state
     * doesn't carry the release yet. Absent: not checked.
     */
    revision?: number | null;
    /** Image digests of the step's release by component (`sha256:…`); absent: not checked. */
    images?: Record<string, string>;
  };
  node: {
    connected: boolean;
    lastSeenAt: number | null;
    agentVersion: string | null;
    components: ComponentVersions | null;
    /** Last revision the node applied completely, and its last apply report. */
    appliedRevision?: number;
    reportRevision?: number | null;
    reportSteps?: { layer: string; status: string; message?: string }[] | null;
  };
  /** Current health entities (failed / at-risk ones are enough). */
  health: { key: string; kind: string; state: string; reasons: { code: string }[] }[];
  slos: { key: string; state: string }[];
  /** Replication as reported by every node holding volumes. */
  replication: { node: string; syncing: number; degraded: number }[];
  /** Control-plane members: connected, their Patroni role / replica lag and their etcd's view. */
  members: {
    name: string;
    connected: boolean;
    witness: boolean;
    postgres?: string;
    postgresLag?: number;
    etcd?: { healthy: boolean; members: number };
  }[];
}

const UNHEALTHY = new Set(['failed', 'at-risk']);
/** A Patroni replica further behind than this isn't caught up (Patroni's `maximum_lag_on_failover` default). */
export const MAX_REPLICA_LAG_BYTES = 1024 * 1024;
/** Apply layers whose failure means the release's containers didn't come up: the step fails at once. */
const RELEASE_LAYERS = new Set(['components', 'control-plane']);
/** Containers a member runs when the release ships their image (witnesses only run etcd). */
const MEMBER_COMPONENTS = ['etcd', 'postgres', 'control-plane'];

/** Whether a reported container image runs exactly the release's digest. */
export function runsDigest(image: string | undefined, digest: string): boolean {
  return !!image && image.endsWith(digest);
}

/** The baseline a step's gates compare against. */
export function gateBaseline(health: GateInput['health'], slos: GateInput['slos']): GateBaseline {
  return {
    unhealthy: health.filter((h) => UNHEALTHY.has(h.state)).map((h) => `${h.key}:${h.state}`),
    burning: slos.filter((s) => s.state === 'burning' || s.state === 'exhausted').map((s) => s.key),
  };
}

export function evaluateGates(input: GateInput): { state: GateState; gates: GateResult[] } {
  const gates: GateResult[] = [];
  const { step, node } = input;
  const gate = (name: string, state: GateState, message: string) => gates.push({ name, state, message });
  const fresh = node.connected && node.lastSeenAt !== null && input.now - node.lastSeenAt <= input.heartbeatTimeoutMs;

  gate(
    'reconnected',
    fresh ? 'pass' : 'wait',
    fresh ? `${step.node} is connected` : `waiting for ${step.node} to reconnect`,
  );

  const failedAction = (node.components?.actions ?? []).find(
    (a) =>
      step.actionIds.includes(a.id) &&
      (a.phase === 'failed' || a.phase === 'rolled-back') &&
      // Actions keyed by release (`images:` / `self-update:`) repeat across attempts: only this attempt's count.
      !(a.id.includes(':') && step.startedAt && Date.parse(a.at) < step.startedAt),
  );

  if (failedAction)
    gate(
      'action',
      'fail',
      `${failedAction.kind} on ${step.node} ${failedAction.phase}: ${failedAction.error ?? 'no details'}`,
    );
  else gate('action', 'pass', 'no update action failed');

  if (step.release !== null) {
    const release = node.components?.release ?? null;
    const agentOk = step.agentVersion === null || node.agentVersion === step.agentVersion;

    if (release === step.release && agentOk)
      gate(
        'version',
        'pass',
        `${step.node} runs ${step.release}${step.agentVersion ? ` (agent ${step.agentVersion})` : ''}`,
      );
    else
      gate(
        'version',
        'wait',
        `waiting for ${step.node} to report ${step.release} (reports ${release ?? 'none'}, agent ${node.agentVersion ?? 'unknown'})`,
      );
  }

  if (step.release !== null && step.revision !== undefined) applyGate(input, gate);

  if (step.release !== null && step.images) imagesGate(input, step.images, gate);

  if (step.bootIdBefore !== undefined) {
    const rebooted = !!node.components?.bootId && node.components.bootId !== step.bootIdBefore;

    gate(
      'reboot',
      rebooted ? 'pass' : 'wait',
      rebooted ? `${step.node} rebooted` : `waiting for ${step.node} to reboot`,
    );
  }

  // Health: entities that became failed fail the step; ones that became at-risk are waited for (replicas moving).
  const before = new Set(step.baseline.unhealthy);
  const fresher = input.health.filter(
    (h) =>
      UNHEALTHY.has(h.state) &&
      !before.has(`${h.key}:${h.state}`) &&
      // The node under maintenance is expected to be degraded / briefly unreachable while it restarts.
      !(h.key === `node/${step.node}` && h.reasons.every((r) => r.code === 'maintenance' || r.code === 'node-down')),
  );
  const newlyFailed = fresher.filter((h) => h.state === 'failed' && h.kind !== 'cluster' && h.kind !== 'site');

  if (newlyFailed.length)
    gate(
      'health',
      'fail',
      `${newlyFailed
        .map((h) => h.key)
        .slice(0, 5)
        .join(', ')} failed since the step started`,
    );
  else if (fresher.length)
    gate(
      'health',
      'wait',
      `waiting for ${fresher
        .map((h) => h.key)
        .slice(0, 5)
        .join(', ')} to recover`,
    );
  else gate('health', 'pass', 'health is not worse than before the step');

  const burning = input.slos.filter(
    (s) => (s.state === 'burning' || s.state === 'exhausted') && !step.baseline.burning.includes(s.key),
  );

  gate(
    'slo',
    burning.length ? 'fail' : 'pass',
    burning.length
      ? `SLO burning since the step started: ${burning.map((s) => s.key).join(', ')}`
      : 'no SLO started burning',
  );

  const lagging = input.replication.filter((r) => r.syncing > 0 || r.degraded > 0);

  gate(
    'replication',
    lagging.length ? 'wait' : 'pass',
    lagging.length
      ? `waiting for replication on ${lagging.map((r) => `${r.node} (${r.syncing} syncing, ${r.degraded} degraded)`).join(', ')}`
      : 'every volume is in sync',
  );

  if (step.member) quorumGate(input, gate);

  const state: GateState = gates.some((g) => g.state === 'fail')
    ? 'fail'
    : gates.some((g) => g.state === 'wait')
      ? 'wait'
      : 'pass';

  return { state, gates };
}

type Gate = (name: string, state: GateState, message: string) => void;

/**
 * The node applied the desired state that carries the step's release, every layer included: a failed components /
 * control-plane layer fails the step (the agent rolled that apply back), another failed layer is waited for.
 */
function applyGate(input: GateInput, gate: Gate): void {
  const { step, node } = input;

  if (step.revision === null || step.revision === undefined) {
    gate('apply', 'wait', `waiting for the desired state of ${step.node} to carry ${step.release}`);

    return;
  }

  const reported =
    node.reportRevision !== null && node.reportRevision !== undefined && node.reportRevision >= step.revision;
  const failed = reported ? (node.reportSteps ?? []).filter((s) => s.status === 'failed') : [];
  const fatal = failed.find((s) => RELEASE_LAYERS.has(s.layer));

  if (fatal)
    gate(
      'apply',
      'fail',
      `${step.node} failed to apply revision ${node.reportRevision} (layer ${fatal.layer}: ${fatal.message ?? 'no details'})`,
    );
  else if (failed.length)
    gate(
      'apply',
      'wait',
      `waiting for ${step.node} to apply revision ${step.revision} (layer ${failed.map((s) => s.layer).join(', ')} failed)`,
    );
  else if ((node.appliedRevision ?? 0) >= step.revision)
    gate('apply', 'pass', `${step.node} applied revision ${node.appliedRevision}`);
  else
    gate(
      'apply',
      'wait',
      `waiting for ${step.node} to apply revision ${step.revision} (applied ${node.appliedRevision ?? 0})`,
    );
}

/**
 * Every platform container the node runs runs the release's digest (development overrides excepted), and a member
 * runs its etcd / Postgres / API containers at all: a stopped container is missing from the report.
 */
function imagesGate(input: GateInput, images: Record<string, string>, gate: Gate): void {
  const { step, node } = input;
  const running = node.components?.images ?? {};
  const overrides = new Set(node.components?.overrides ?? []);
  const wrong = Object.entries(running)
    .filter(([c, image]) => images[c] && !overrides.has(c) && !runsDigest(image, images[c]))
    .map(([c, image]) => `${c} (${image})`);
  const required = step.member ? (step.witness ? ['etcd'] : MEMBER_COMPONENTS) : [];
  const missing = required.filter((c) => images[c] && !overrides.has(c) && !running[c]);

  if (wrong.length)
    gate('images', 'wait', `waiting for ${step.node} to run ${step.release}'s images: ${wrong.slice(0, 5).join(', ')}`);
  else if (missing.length)
    gate('images', 'wait', `waiting for the ${missing.join(', ')} container(s) on ${step.node} to run`);
  else gate('images', 'pass', `${step.node} runs ${step.release}'s images`);
}

/**
 * Control-plane quorum after a member's step: every member connected, etcd healthy everywhere it reports with every
 * voter a member, exactly one Postgres leader, every Postgres member answering and its replicas caught up.
 */
function quorumGate(input: GateInput, gate: Gate): void {
  const members = input.members;
  const down = members.filter((m) => !m.connected);
  const etcdUnhealthy = members.filter((m) => m.etcd && !m.etcd.healthy);
  const etcdShort = members.filter((m) => m.etcd?.healthy && m.etcd.members !== members.length);
  const leaders = members.filter((m) => m.postgres === 'leader');
  const reporting = members.some((m) => m.postgres !== undefined);
  const unknown = members.filter((m) => !m.witness && m.postgres === 'unknown');
  const lagging = members.filter(
    (m) => m.postgres === 'replica' && m.postgresLag !== undefined && m.postgresLag > MAX_REPLICA_LAG_BYTES,
  );

  if (down.length) gate('quorum', 'wait', `waiting for members ${down.map((m) => m.name).join(', ')}`);
  else if (etcdUnhealthy.length)
    gate('quorum', 'wait', `waiting for etcd on ${etcdUnhealthy.map((m) => m.name).join(', ')} to be healthy`);
  else if (etcdShort.length)
    gate(
      'quorum',
      'wait',
      `waiting for etcd membership: ${etcdShort.map((m) => `${m.name} sees ${m.etcd?.members}`).join(', ')} of ${members.length} members`,
    );
  else if (reporting && leaders.length !== 1)
    gate('quorum', 'wait', `waiting for exactly one Postgres leader (${leaders.length} reported)`);
  else if (unknown.length)
    gate('quorum', 'wait', `waiting for Postgres on ${unknown.map((m) => m.name).join(', ')} to answer`);
  else if (lagging.length)
    gate(
      'quorum',
      'wait',
      `waiting for Postgres replicas to catch up: ${lagging.map((m) => `${m.name} (${m.postgresLag} bytes behind)`).join(', ')}`,
    );
  else
    gate('quorum', 'pass', 'every member is connected, etcd is healthy, one Postgres leader with caught-up replicas');
}
