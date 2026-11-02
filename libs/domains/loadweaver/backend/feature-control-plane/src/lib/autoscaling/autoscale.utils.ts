import { parseBytes, parseCpus, type AutoscaleSpec } from '@forepath/loadweaver/shared/util-compose';
import type { ProjectSpec } from '@forepath/loadweaver/shared/util-model';
import {
  analyzeFailures,
  canRunWorkloads,
  schedule,
  type ReplicaPlacement,
  type Resources,
  type SchedulerNode,
  type SchedulerService,
  type VolumePlacement,
} from '@forepath/loadweaver/shared/util-scheduler';

import type { ProjectUsage } from '../access/plan-access.utils';
import { serviceId, type ParsedDeployment } from '../utils/workload-planning.utils';

/**
 * Horizontal autoscaling (3.23), the pure parts: the HPA recommendation with tolerance, scale-down stabilisation and
 * cooldowns, and the limits a scale-up must respect (project quota, cluster capacity, N+1 reserve).
 */

export interface AutoscaleTiming {
  /** No scaling while |value / target − 1| stays within this share (HPA's 10 %). */
  tolerance: number;
  /** Scale-down only to the highest recommendation of this window (and only after observing it fully). */
  downWindowMs: number;
  /** After any scaling action: no scale-up for this long (new replicas start and report first). */
  upCooldownMs: number;
  /** After any scaling action: no scale-down for this long (steps of a falling window are batched). */
  downCooldownMs: number;
  /** A scale-up adds at most max(current × factor, current + step) replicas at once. */
  maxUpFactor: number;
  maxUpStep: number;
  /** Ticks are 15 s apart: the window counts as observed once it spans `downWindowMs` minus this slack. */
  windowSlackMs: number;
}

export const DEFAULT_AUTOSCALE_TIMING: AutoscaleTiming = {
  tolerance: 0.1,
  downWindowMs: 5 * 60_000,
  upCooldownMs: 30_000,
  downCooldownMs: 60_000,
  maxUpFactor: 2,
  maxUpStep: 4,
  windowSlackMs: 30_000,
};

export interface AutoscaleWindowEntry {
  /** Epoch ms of the recommendation. */
  at: number;
  replicas: number;
}

export interface RecommendInput {
  spec: AutoscaleSpec;
  /** Replicas placed now. */
  current: number;
  /** The metric's current value in the target's unit; null = missing (the autoscaler holds). */
  value: number | null;
  /** Why the value is missing. */
  missing?: string;
  now: number;
  window: readonly AutoscaleWindowEntry[];
  lastScaleAt: number | null;
}

export interface Recommendation {
  action: 'up' | 'down' | 'hold';
  /** Replicas to run (before the quota / capacity / N+1 limits of a scale-up). */
  desired: number;
  /** HPA's raw result, before min / max (null without a value). */
  raw: number | null;
  /** This tick's recommendation within min..max (null without a value). */
  recommendation: number | null;
  /** The pruned window including this tick's recommendation; stored for the next tick. */
  window: AutoscaleWindowEntry[];
  reason: string;
  /** More replicas were wanted than `max` allows. */
  atMax: boolean;
}

export function metricName(spec: AutoscaleSpec): string {
  return spec.metric === 'custom' ? (spec.customMetric ?? 'custom') : spec.metric;
}

function formatNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(Math.abs(n) >= 100 ? 0 : Math.abs(n) >= 10 ? 1 : 2);
}

/** `cpu 85 % / target 70 %`, `requests 120 / target 50 per replica`, `ingress.latency_p95_ms 410 / target 300`. */
export function describeMetric(spec: AutoscaleSpec, value: number): string {
  switch (spec.metric) {
    case 'cpu':
    case 'memory':
      return `${spec.metric} ${formatNumber(value)} % / target ${formatNumber(spec.target)} %`;
    case 'requests':
      return `requests ${formatNumber(value)}/s / target ${formatNumber(spec.target)}/s per replica`;
    default:
      return `${metricName(spec)} ${formatNumber(value)} / target ${formatNumber(spec.target)}`;
  }
}

/** The replicas an autoscaled service runs: the autoscaler's count (or the compose count at first), within min..max. */
export function autoscaledCount(spec: AutoscaleSpec, state: number | undefined, composeReplicas: number): number {
  return Math.min(spec.max, Math.max(spec.min, state ?? composeReplicas));
}

/**
 * The HPA recommendation (`desired = ceil(current × value / target)`), with a tolerance band, immediate but bounded
 * scale-up, and scale-down only to the highest recommendation of a fully observed stabilisation window. Missing
 * metrics hold. Every result stays within min..max.
 */
export function recommend(input: RecommendInput, timing: AutoscaleTiming = DEFAULT_AUTOSCALE_TIMING): Recommendation {
  const { spec, current, now } = input;
  const clamp = (n: number) => Math.min(spec.max, Math.max(spec.min, n));
  const window = input.window.filter((e) => e.at > now - timing.downWindowMs && e.at <= now);
  const sinceScale = input.lastScaleAt === null ? Infinity : now - input.lastScaleAt;

  // A plan changed min / max (or nothing ran yet): back into the range first, whatever the metric says.
  if (current !== clamp(current)) {
    const desired = clamp(current);

    return {
      action: desired > current ? 'up' : 'down',
      desired,
      raw: null,
      recommendation: desired,
      window,
      reason: `${current} replicas outside ${spec.min}..${spec.max}`,
      atMax: false,
    };
  }

  if (input.value === null || !Number.isFinite(input.value)) {
    return {
      action: 'hold',
      desired: current,
      raw: null,
      recommendation: null,
      window,
      reason: `holding: ${input.missing ?? `no ${metricName(spec)} metrics`}`,
      atMax: false,
    };
  }

  const value = Math.max(0, input.value);
  const ratio = value / spec.target;
  const raw = Math.abs(ratio - 1) <= timing.tolerance ? current : Math.ceil(current * ratio - 1e-9);
  const recommendation = clamp(raw);
  const metric = describeMetric(spec, value);

  window.push({ at: now, replicas: recommendation });

  const atMax = raw > spec.max;

  if (recommendation > current) {
    if (sinceScale < timing.upCooldownMs)
      return {
        action: 'hold',
        desired: current,
        raw,
        recommendation,
        window,
        reason: `${metric}: cooldown, scaling up to ${recommendation} after ${Math.ceil((timing.upCooldownMs - sinceScale) / 1000)} s`,
        atMax,
      };

    const step = Math.max(current * timing.maxUpFactor, current + timing.maxUpStep);
    const desired = Math.min(recommendation, step);

    return {
      action: 'up',
      desired,
      raw,
      recommendation,
      window,
      reason: `${metric}${desired < recommendation ? ` (step limited, wants ${recommendation})` : ''}`,
      atMax,
    };
  }

  if (recommendation < current) {
    const stable = Math.max(...window.map((e) => e.replicas));
    const observed = now - Math.min(...window.map((e) => e.at)) >= timing.downWindowMs - timing.windowSlackMs;

    if (stable >= current || !observed)
      return {
        action: 'hold',
        desired: current,
        raw,
        recommendation,
        window,
        reason: `${metric}: stabilising, scale-down to ${Math.max(stable < current ? stable : recommendation, spec.min)} once lower for ${Math.round(timing.downWindowMs / 60_000)} min`,
        atMax,
      };

    if (sinceScale < timing.downCooldownMs)
      return {
        action: 'hold',
        desired: current,
        raw,
        recommendation,
        window,
        reason: `${metric}: cooldown, scaling down to ${stable} after ${Math.ceil((timing.downCooldownMs - sinceScale) / 1000)} s`,
        atMax,
      };

    return { action: 'down', desired: stable, raw, recommendation, window, reason: metric, atMax };
  }

  return {
    action: 'hold',
    desired: current,
    raw,
    recommendation,
    window,
    reason: atMax
      ? `${metric}: at max ${spec.max} (wants ${raw})`
      : raw < spec.min && current === spec.min
        ? `${metric}: at min ${spec.min}`
        : `${metric}: within ${Math.round(timing.tolerance * 100)} % of the target`,
    atMax,
  };
}

/**
 * The largest replica count in (current, desired] that passes `check` (null = allowed), assuming larger counts
 * never pass where a smaller one failed. Returns `current` and the reason when not even one more fits.
 */
export function largestAllowed(
  current: number,
  desired: number,
  check: (replicas: number) => string | null,
): { replicas: number; blocked: string | null } {
  if (desired <= current) return { replicas: desired, blocked: null };

  const atDesired = check(desired);

  if (atDesired === null) return { replicas: desired, blocked: null };

  let lo = current;
  let hi = desired - 1;
  let reason = atDesired;

  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const issue = check(mid);

    if (issue === null) lo = mid;
    else {
      reason = issue;
      hi = mid - 1;
    }
  }

  return { replicas: lo, blocked: reason };
}

/**
 * Whether `extra` more replicas of `requests` stay within the project's CPU / memory quota (3.17), given what the
 * project uses now (with the current autoscaled counts).
 */
export function quotaBlock(
  project: string,
  quota: ProjectSpec['quota'] | undefined,
  usage: ProjectUsage | undefined,
  requests: Resources,
  extra: number,
): string | null {
  if (!quota || extra <= 0) return null;

  const cpu = quota.cpu ? parseCpus(quota.cpu) : null;
  const memory = quota.memory ? parseBytes(quota.memory) : null;
  const usedCpu = (usage?.cpuMillis ?? 0) + extra * requests.cpuMillis;
  const usedMemory = (usage?.memoryBytes ?? 0) + extra * requests.memoryBytes;
  const gib = (n: number) => `${(n / 1024 ** 3).toFixed(2).replace(/\.?0+$/, '')} GiB`;

  if (cpu !== null && cpu !== undefined && usedCpu > cpu)
    return `project ${project} quota: CPU ${usedCpu / 1000} would exceed ${cpu / 1000}`;

  if (memory !== null && memory !== undefined && usedMemory > memory)
    return `project ${project} quota: memory ${gib(usedMemory)} would exceed ${gib(memory)}`;

  return null;
}

/** Requested resources per node of a set of placements. */
export function allocation(
  replicas: readonly ReplicaPlacement[],
  services: readonly SchedulerService[],
): Record<string, Resources> {
  const requests = new Map(services.map((s) => [s.id, s.requests]));
  const allocated: Record<string, Resources> = {};

  for (const r of replicas) {
    const req = requests.get(r.service);

    if (!req) continue;

    const used = allocated[r.node] ?? { cpuMillis: 0, memoryBytes: 0 };

    allocated[r.node] = { cpuMillis: used.cpuMillis + req.cpuMillis, memoryBytes: used.memoryBytes + req.memoryBytes };
  }

  return allocated;
}

export interface CapacityInput {
  nodes: readonly SchedulerNode[];
  /** Every placed service with its current replica count. */
  services: readonly SchedulerService[];
  /** What runs now (cron runs excluded, like the planner). */
  current: { replicas: readonly ReplicaPlacement[]; volumes: readonly VolumePlacement[] };
}

/** Node-loss capacity findings (the N+1 reserve, 3.12) of a layout. */
function reserveFindings(input: CapacityInput, replicas: readonly ReplicaPlacement[]): number {
  return analyzeFailures(
    input.nodes,
    input.services,
    {
      replicas: [...replicas],
      volumes: [...input.current.volumes],
      unschedulable: [],
      allocated: allocation(replicas, input.services),
    },
    'node',
  ).findings.filter((f) => f.kind === 'capacity' && f.scope.kind === 'node').length;
}

/**
 * Places `replicas` replicas of `service` with the scheduler, keeping every other placement where it is (3.2):
 * the new replicas must fit the free capacity, and the N+1 reserve must not shrink — a layout that survives every
 * single node loss must still survive it; one that doesn't already (or a single workload node) may not get worse.
 */
export function placeScaleUp(
  input: CapacityInput,
  service: string,
  replicas: number,
): { added: ReplicaPlacement[]; issue: string | null } {
  const target = input.services.find((s) => s.id === service);

  if (!target) return { added: [], issue: `${service} is not placed` };

  const services = input.services.map((s) => (s.id === service ? { ...s, replicas } : s));
  const placed = new Set(input.current.replicas.map((r) => r.replica));
  const result = schedule({
    nodes: [...input.nodes],
    services,
    current: { replicas: [...input.current.replicas], volumes: [...input.current.volumes] },
  });
  const added = result.replicas.filter((r) => r.service === service && !placed.has(r.replica));
  const missing = result.unschedulable.find((u) => u.service === service && (!u.replica || !placed.has(u.replica)));

  if (missing) return { added: [], issue: `cluster capacity: ${missing.reason}` };

  const after = [...input.current.replicas, ...added];
  const allocated = allocation(after, services);
  const nodes = new Map(input.nodes.map((n) => [n.name, n]));

  // The scheduler may have juggled other replicas in its own ledger; what counts is the real layout.
  for (const node of new Set(added.map((r) => r.node))) {
    const n = nodes.get(node);
    const used = allocated[node];

    if (!n || used.cpuMillis > n.capacity.cpuMillis || used.memoryBytes > n.capacity.memoryBytes)
      return { added: [], issue: `cluster capacity: not enough free capacity on ${node}` };
  }

  if (input.nodes.filter(canRunWorkloads).length >= 2) {
    const withServices = { ...input, services };

    if (reserveFindings(withServices, after) > reserveFindings(withServices, input.current.replicas))
      return {
        added: [],
        issue: 'N+1 reserve: the cluster could no longer absorb the loss of a node',
      };
  }

  return { added, issue: null };
}

/** Index of a replica id (`project/deployment/service/<index>`). */
export function replicaIndex(id: string): number {
  return Number(id.split('/').at(-1));
}

/** Scale-down removes the newest replicas first (highest index; blue / green-safe: the others keep serving). */
export function replicasToRemove(placed: readonly string[], keep: number): string[] {
  return [...placed].sort((a, b) => replicaIndex(b) - replicaIndex(a)).slice(0, Math.max(0, placed.length - keep));
}

export interface AutoscaledService {
  id: string;
  project: string;
  deployment: string;
  service: string;
  spec: AutoscaleSpec;
  replicas: number;
  composeReplicas: number;
}

/**
 * Applies the autoscaler's counts to parsed deployments (in place): autoscaled services run `autoscaledCount`
 * replicas instead of their compose `replicas`. Returns the autoscaled services.
 */
export function applyAutoscaledReplicas(
  parsed: readonly ParsedDeployment[],
  states: ReadonlyMap<string, number>,
): AutoscaledService[] {
  const out: AutoscaledService[] = [];

  for (const d of parsed)
    for (const s of d.compose.services) {
      if (!s.autoscale || s.kind !== 'service') continue;

      const id = serviceId(d.project, d.name, s.name);
      const composeReplicas = s.replicas;

      s.replicas = autoscaledCount(s.autoscale, states.get(id), composeReplicas);
      out.push({
        id,
        project: d.project,
        deployment: d.name,
        service: s.name,
        spec: s.autoscale,
        replicas: s.replicas,
        composeReplicas,
      });
    }

  return out;
}

/** "autoscaled 3 (2..10), cpu target 70 %": how a plan shows an autoscaled service. */
export function autoscalePlanLine(s: Pick<AutoscaledService, 'spec' | 'replicas'>): string {
  const target =
    s.spec.metric === 'cpu' || s.spec.metric === 'memory'
      ? `${s.spec.metric} target ${s.spec.target} % of the request`
      : s.spec.metric === 'requests'
        ? `requests target ${s.spec.target}/s per replica`
        : `${metricName(s.spec)} target ${s.spec.target}`;

  return `autoscaled ${s.replicas} (${s.spec.min}..${s.spec.max}), ${target}`;
}

/** Hostname metric aggregation for custom metrics: rates add up across ingress nodes / hosts, the rest takes the worst. */
export function combineHostValues(metric: string, values: readonly number[]): number | null {
  if (values.length === 0) return null;

  return /_per_s$/.test(metric) ? values.reduce((a, b) => a + b, 0) : Math.max(...values);
}

export function average(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * What a plan says about autoscaling (3.23): an info line per autoscaled service of the deployments it submits
 * ("autoscaled 3 (2..10)"), and a warning per project whose quota is checked against `min` but wouldn't hold `max`.
 */
export function autoscalePlanNotes(
  parsed: readonly ParsedDeployment[],
  autoscaled: readonly AutoscaledService[],
  usage: ReadonlyMap<string, ProjectUsage>,
  quotas: ReadonlyMap<string, ProjectSpec['quota'] | undefined>,
  submitted: ReadonlySet<string>,
): Record<string, unknown>[] {
  const notes: Record<string, unknown>[] = [];
  const requests = new Map(
    parsed.flatMap((d) =>
      d.compose.services.map((s) => [serviceId(d.project, d.name, s.name), s.resources.requests] as const),
    ),
  );

  for (const a of autoscaled.filter((x) => submitted.has(`${x.project}/${x.deployment}`)))
    notes.push({
      level: 'info',
      project: a.project,
      deployment: a.deployment,
      path: `services.${a.service}.x-loadweaver.autoscale`,
      message: autoscalePlanLine(a),
      autoscale: {
        replicas: a.replicas,
        min: a.spec.min,
        max: a.spec.max,
        metric: metricName(a.spec),
        target: a.spec.target,
      },
    });

  for (const project of new Set(
    autoscaled.filter((x) => submitted.has(`${x.project}/${x.deployment}`)).map((x) => x.project),
  )) {
    const extra = autoscaled
      .filter((x) => x.project === project)
      .reduce(
        (sum, x) => {
          const r = requests.get(x.id) ?? { cpuMillis: 0, memoryBytes: 0 };
          const n = x.spec.max - x.spec.min;

          return { cpuMillis: sum.cpuMillis + n * r.cpuMillis, memoryBytes: sum.memoryBytes + n * r.memoryBytes };
        },
        { cpuMillis: 0, memoryBytes: 0 },
      );
    // `extra` as one replica of the summed requests.
    const issue = quotaBlock(project, quotas.get(project), usage.get(project), extra, 1);

    if (issue)
      notes.push({
        level: 'warning',
        project,
        path: 'x-loadweaver.autoscale',
        message: `at max replicas, autoscaled services exceed the ${issue.replace(/^project \S+ quota: /, 'quota: ')}; the autoscaler stops at the quota`,
      });
  }

  return notes;
}

/** What the map shows on each replica of an autoscaled service (3.23): range and last scaling (an event). */
export function autoscaleMapData(row: {
  replicas: number;
  last_scale_at: Date | string | null;
  last_reason: string | null;
  status: Pick<AutoscaleStatusLike, 'min' | 'max' | 'blocked'> | null;
}): Record<string, string> {
  return {
    autoscaled: row.status ? `${row.replicas} (${row.status.min}..${row.status.max})` : String(row.replicas),
    ...(row.last_scale_at && row.last_reason
      ? { lastScaled: `${new Date(row.last_scale_at).toISOString()} ${row.last_reason}` }
      : {}),
    ...(row.status?.blocked ? { autoscaleBlocked: row.status.blocked } : {}),
  };
}

interface AutoscaleStatusLike {
  min: number;
  max: number;
  blocked: string | null;
}
