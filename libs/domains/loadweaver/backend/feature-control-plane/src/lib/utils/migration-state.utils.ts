import {
  migrationChannel,
  type CheckpointRuntime,
  type ControlPlaneMessageType,
  type ControlPlanePayload,
  type MigrationReportPhase,
  type TransferEndpoint,
  type WorkloadSpec,
} from '@forepath/loadweaver/shared/util-agent-protocol';
import { cidrContainsIp, parseCidr, parseIp } from '@forepath/loadweaver/shared/util-network';

/**
 * The control-plane side of live migration (3.10) as pure functions: the phase state machine with its fallback
 * paths, dependency waves, kept-address bookkeeping and the commands a session sends to the nodes.
 */

export const CHECKPOINT_PHASES = ['prepare', 'precopy', 'freeze', 'transfer', 'restore', 'cutover'] as const;
export type CheckpointPhase = (typeof CHECKPOINT_PHASES)[number];
/** Phases of a checkpoint attempt: the forward phases, `aborting` (a failure, the source resumes) and the end. */
export type SessionPhase = CheckpointPhase | 'aborting';

export interface MigrationTimeouts {
  prepare: number;
  precopy: number;
  freeze: number;
  transfer: number;
  restore: number;
  cutover: number;
  aborting: number;
}

/** Per-phase limits; any phase over its limit aborts the attempt (the replica stays where it runs). */
export const DEFAULT_MIGRATION_TIMEOUTS: MigrationTimeouts = {
  prepare: 120_000,
  precopy: 600_000,
  freeze: 60_000,
  transfer: 300_000,
  restore: 120_000,
  cutover: 120_000,
  aborting: 60_000,
};

/** What one node reported for one phase of the current attempt. */
export interface NodeReport {
  status: 'running' | 'done' | 'failed';
  at: string;
  error?: string;
  endpoint?: TransferEndpoint;
  resumed?: boolean;
  round?: number;
  bytes?: number;
  totalBytes?: number;
  dirtyBytesPerSecond?: number;
  freezeMs?: number;
}

export type SessionReports = Partial<Record<'source' | 'target', Partial<Record<MigrationReportPhase, NodeReport>>>>;

export interface SessionState {
  method: 'live' | 'stop-and-copy';
  phase: SessionPhase;
  phaseStartedAt: number;
  reports: SessionReports;
  /** The attempt reached `restore`: the target may run the replica, so the source resumes only once it's gone. */
  restoreSent: boolean;
  /** The target node counts as lost (no heartbeat): it can't confirm an abort. */
  targetLost: boolean;
}

export type SessionDecision =
  | { kind: 'wait' }
  | { kind: 'phase'; phase: CheckpointPhase }
  /** The target runs the restored replica: switch the placement over. */
  | { kind: 'cutover' }
  /** Commit confirmed (or given up waiting): the attempt is done. */
  | { kind: 'done' }
  | { kind: 'abort'; reason: string }
  /** Abort finished: continue with the short-stop / blue-green path. */
  | { kind: 'fallback'; resumed: boolean };

const report = (state: Pick<SessionState, 'reports'>, role: 'source' | 'target', phase: MigrationReportPhase) =>
  state.reports[role]?.[phase];

const doneReport = (state: Pick<SessionState, 'reports'>, role: 'source' | 'target', phase: MigrationReportPhase) =>
  report(state, role, phase)?.status === 'done';

/**
 * While aborting: the source may resume once nothing can run on the target any more: restore was never sent, the
 * target confirmed the abort, the target is lost, or it stayed silent for a whole abort timeout (its desired state
 * never contained the replica, so its agent removes an unknown restored container anyway).
 */
export function sourceMayResume(state: SessionState, now: number, timeouts: MigrationTimeouts): boolean {
  return (
    !state.restoreSent ||
    state.targetLost ||
    report(state, 'target', 'abort') !== undefined ||
    now - state.phaseStartedAt > timeouts.aborting
  );
}

/** One step of a checkpoint migration attempt (3.10). Never kills the source before the target runs. */
export function sessionStep(
  state: SessionState,
  now: number,
  timeouts: MigrationTimeouts = DEFAULT_MIGRATION_TIMEOUTS,
): SessionDecision {
  const elapsed = now - state.phaseStartedAt;

  if (state.phase === 'aborting') {
    const source = report(state, 'source', 'abort');

    if (source && source.status !== 'running') return { kind: 'fallback', resumed: !!source.resumed };

    // Give up waiting for the source after two abort timeouts: the short-stop path takes over its container.
    if (elapsed > 2 * timeouts.aborting) return { kind: 'fallback', resumed: false };

    return { kind: 'wait' };
  }

  if (state.phase === 'cutover') {
    // Commit is best effort: the source's desired state no longer has the replica either way.
    if (report(state, 'source', 'commit') && report(state, 'target', 'commit')) return { kind: 'done' };

    return elapsed > timeouts.cutover ? { kind: 'done' } : { kind: 'wait' };
  }

  for (const role of ['target', 'source'] as const) {
    for (const [phase, r] of Object.entries(state.reports[role] ?? {}) as [MigrationReportPhase, NodeReport][]) {
      if (r.status === 'failed' && phase !== 'commit' && phase !== 'abort')
        return { kind: 'abort', reason: `${role} ${phase} failed${r.error ? `: ${r.error}` : ''}` };
    }
  }

  if (state.targetLost) return { kind: 'abort', reason: 'target node lost' };

  switch (state.phase) {
    case 'prepare':
      if (doneReport(state, 'target', 'prepare') && report(state, 'target', 'prepare')?.endpoint)
        return { kind: 'phase', phase: state.method === 'live' ? 'precopy' : 'freeze' };
      break;
    case 'precopy':
      if (doneReport(state, 'source', 'precopy')) return { kind: 'phase', phase: 'freeze' };
      break;
    case 'freeze':
      if (doneReport(state, 'source', 'freeze') || report(state, 'source', 'transfer'))
        return doneReport(state, 'source', 'transfer')
          ? { kind: 'phase', phase: 'restore' }
          : { kind: 'phase', phase: 'transfer' };
      break;
    case 'transfer':
      if (doneReport(state, 'source', 'transfer')) return { kind: 'phase', phase: 'restore' };
      break;
    case 'restore':
      if (doneReport(state, 'target', 'restore')) return { kind: 'cutover' };
      break;
  }

  if (elapsed > timeouts[state.phase])
    return { kind: 'abort', reason: `${state.phase} timed out after ${Math.round(timeouts[state.phase] / 1000)} s` };

  return { kind: 'wait' };
}

/** The measurements of an attempt for the history (3.10). */
export function sessionMetrics(reports: SessionReports): {
  precopyRounds: number | null;
  checkpointBytes: number | null;
  freezeMs: number | null;
} {
  const all = [...Object.values(reports.source ?? {}), ...Object.values(reports.target ?? {})];
  const max = (values: (number | undefined)[]) => {
    const present = values.filter((v): v is number => typeof v === 'number');

    return present.length > 0 ? Math.max(...present) : null;
  };

  return {
    precopyRounds: max([reports.source?.precopy?.round]),
    checkpointBytes: max(all.map((r) => r.totalBytes)),
    freezeMs: max(all.map((r) => r.freezeMs)),
  };
}

/**
 * Dependency waves (3.10, 3.11): replicas of a deployment move in `depends_on` order. Each moving replica waits for
 * the moving replicas of the services it depends on, directly or transitively (`dependsOn`: service → services).
 */
export function waveDependencies(
  dependsOn: ReadonlyMap<string, readonly string[]>,
  moving: readonly { replica: string; service: string }[],
): Map<string, string[]> {
  const closure = (service: string): Set<string> => {
    const seen = new Set<string>();
    const stack = [...(dependsOn.get(service) ?? [])];

    while (stack.length > 0) {
      const next = stack.pop() as string;

      if (seen.has(next) || next === service) continue;

      seen.add(next);
      stack.push(...(dependsOn.get(next) ?? []));
    }

    return seen;
  };
  const result = new Map<string, string[]>();

  for (const m of moving) {
    const deps = closure(m.service);

    result.set(
      m.replica,
      moving.filter((o) => deps.has(o.service)).map((o) => o.replica),
    );
  }

  return result;
}

const READY = new Set(['running', 'healthy']);

/** The previous wave is through: every replica waited for has moved and runs (healthy if it has a check). */
export function waveReady(
  after: readonly string[],
  placements: readonly {
    id: string;
    node: string;
    migration: unknown;
    status: Record<string, { state: string }> | null;
  }[],
): boolean {
  const byId = new Map(placements.map((p) => [p.id, p]));

  return after.every((id) => {
    const p = byId.get(id);

    // Removed meanwhile: nothing to wait for.
    if (!p) return true;

    return !p.migration && READY.has(p.status?.[p.node]?.state ?? '');
  });
}

function inSubnets(address: string, subnets: readonly string[]): boolean {
  const ip = parseIp(address.split('/')[0]);

  return (
    !!ip &&
    subnets.some((s) => {
      const cidr = parseCidr(s);

      return !!cidr && cidrContainsIp(cidr, ip);
    })
  );
}

/** Addresses a replica kept from another node's pod subnet (live migration keeps addresses, 3.10). */
export function keptAddresses(addresses: readonly string[], nodeSubnets: readonly string[]): string[] {
  return addresses.filter((a) => !inSubnets(a, nodeSubnets));
}

/** The node whose pod subnet an address belongs to: it must never hand the address out while it is kept. */
export function subnetOwner(address: string, podSubnets: ReadonlyMap<string, readonly string[]>): string | null {
  for (const [node, subnets] of podSubnets) if (inSubnets(address, subnets)) return node;

  return null;
}

/** Host routes (`/32`, `/128`) of kept addresses, for the desired-state hint. */
export function hostRoutes(addresses: readonly string[]): string[] {
  return addresses.map((a) => (a.includes(':') ? `${a}/128` : `${a}/32`));
}

/** A checkpoint attempt as the session service sees it (one `lw_migrations` row). */
export interface SessionRecord {
  id: string;
  attempt: number;
  replica: string;
  fromNode: string;
  toNode: string;
  method: 'live' | 'stop-and-copy';
  runtime: CheckpointRuntime;
  phase: SessionPhase;
  phaseStartedAt: number;
  token: string;
  addresses: string[];
  volumes: string[];
  spec: WorkloadSpec | null;
  reports: SessionReports;
  restoreSent: boolean;
  targetLost: boolean;
}

export interface SessionOptions {
  maxRounds: number;
  convergeBytes: number;
  freezeBudgetMs: number;
  endpointSeconds: number;
}

export const DEFAULT_SESSION_OPTIONS: SessionOptions = {
  maxRounds: 8,
  convergeBytes: 4 * 1024 * 1024,
  freezeBudgetMs: 3_000,
  endpointSeconds: 900,
};

export interface SessionCommand<T extends ControlPlaneMessageType = ControlPlaneMessageType> {
  node: string;
  type: T;
  channel: string;
  payload: ControlPlanePayload<T>;
}

/**
 * The commands due in a session's current phase, per node: each is sent (and re-sent) until the node reports
 * the phase. Commands are idempotent per (migration, attempt, type) on the agent.
 */
export function sessionCommands(
  record: SessionRecord,
  now: number,
  options: SessionOptions = DEFAULT_SESSION_OPTIONS,
  timeouts: MigrationTimeouts = DEFAULT_MIGRATION_TIMEOUTS,
): SessionCommand[] {
  const base = { migration: record.id, attempt: record.attempt, replica: record.replica };
  const channel = migrationChannel(record.id);
  const unreported = (role: 'source' | 'target', phase: MigrationReportPhase) => !record.reports[role]?.[phase];
  const endpoint = record.reports.target?.prepare?.endpoint;
  const commands: SessionCommand[] = [];
  const add = <T extends ControlPlaneMessageType>(node: string, type: T, payload: ControlPlanePayload<T>) =>
    commands.push({ node, type, channel, payload } as unknown as SessionCommand);

  switch (record.phase) {
    case 'prepare':
      if (unreported('target', 'prepare') && record.spec)
        add(record.toNode, 'migrationPrepare', {
          ...base,
          source: record.fromNode,
          runtime: record.runtime,
          token: record.token,
          addresses: record.addresses,
          expiresInSeconds: options.endpointSeconds,
          spec: record.spec,
        });
      break;
    case 'precopy':
      if (unreported('source', 'precopy') && endpoint)
        add(record.fromNode, 'migrationPrecopy', {
          ...base,
          target: record.toNode,
          endpoint,
          token: record.token,
          maxRounds: options.maxRounds,
          convergeBytes: options.convergeBytes,
        });
      break;
    case 'freeze':
    case 'transfer':
      if (unreported('source', 'freeze') && unreported('source', 'transfer') && endpoint)
        add(record.fromNode, 'migrationFreeze', {
          ...base,
          target: record.toNode,
          endpoint,
          token: record.token,
          runtime: record.runtime,
          volumes: record.volumes,
          freezeBudgetMs: options.freezeBudgetMs,
        });
      break;
    case 'restore':
      if (unreported('target', 'restore'))
        add(record.toNode, 'migrationRestore', {
          ...base,
          runtime: record.runtime,
          volumes: record.volumes,
          addresses: record.addresses,
        });
      break;
    case 'cutover':
      if (unreported('source', 'commit')) add(record.fromNode, 'migrationCommit', { ...base, role: 'source' });

      if (unreported('target', 'commit')) add(record.toNode, 'migrationCommit', { ...base, role: 'target' });
      break;
    case 'aborting': {
      const reason = 'migration attempt aborted';

      if (unreported('target', 'abort') && !record.targetLost)
        add(record.toNode, 'migrationAbort', { ...base, role: 'target', reason, volumes: record.volumes });

      if (unreported('source', 'abort') && sourceMayResume(record, now, timeouts))
        add(record.fromNode, 'migrationAbort', { ...base, role: 'source', reason, volumes: record.volumes });
      break;
    }
  }

  return commands;
}
