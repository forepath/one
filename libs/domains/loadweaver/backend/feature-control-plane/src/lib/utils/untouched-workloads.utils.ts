import { VM_DEPLOYMENT_NAME } from '@forepath/loadweaver/shared/util-model';
import type {
  ReplicaPlacement,
  ScheduleResult,
  Unschedulable,
  VolumePlacement,
} from '@forepath/loadweaver/shared/util-scheduler';

import type { PlanResourceChange } from '../entities/plan.entity';
import type { DeploymentIssue } from './workload-planning.utils';

/**
 * Services (`project/deployment/service`) a plan adds or changes: only their placement failures reject it (user
 * decision 2026-11-01). The others wait for a node where they are.
 */
export type TouchedWorkloads = (service: string) => boolean;

/** Re-plans without a plan of their own (pending volume copies, failover, drain): every placement failure waits. */
export const NOTHING_TOUCHED: TouchedWorkloads = () => false;

/**
 * The workloads a plan touches: the deployments and VMs it creates or updates, and the deployments it pins again
 * (`resolved`: deployment ids — the preview's re-resolved deployments, the stored plan's deployment states). A
 * project's VM state (`<project>/lw-vm`) isn't a change of all its VMs: VMs count per VM (3.35). Projects, nodes and
 * the cluster touch no workload.
 */
export function touchedWorkloads(
  changes: readonly Pick<PlanResourceChange, 'action' | 'kind' | 'name' | 'project'>[],
  resolved: Iterable<string> = [],
): TouchedWorkloads {
  const deployments = new Set<string>();
  const services = new Set<string>();

  for (const change of changes) {
    if (!change.project || (change.action !== 'create' && change.action !== 'update')) continue;

    if (change.kind === 'Deployment') deployments.add(`${change.project}/${change.name}`);

    if (change.kind === 'VirtualMachine') services.add(`${change.project}/${VM_DEPLOYMENT_NAME}/${change.name}`);
  }

  for (const id of resolved) {
    const [project, deployment, rest] = id.split('/');

    if (project && deployment && rest === undefined && deployment !== VM_DEPLOYMENT_NAME) deployments.add(id);
  }

  return (service) => services.has(service) || deployments.has(service.split('/').slice(0, 2).join('/'));
}

/** An untouched workload the scheduler couldn't place, with the nodes its replicas keep (`cause`: see `Unschedulable`). */
export interface WaitingWorkload extends Unschedulable {
  nodes: string[];
}

/**
 * Keeps untouched workloads that can't be placed where they are (user decision 2026-11-01): their current replicas
 * and volume holders go back into the schedule, they leave `unschedulable` and are reported as `waiting`. Replicas
 * that never ran (e.g. autoscaled ones) get no placement until a node can run them. With `nodes` (the planner's
 * nodes), replicas on nodes that left are not kept: they are gone (DR recovery marks the lost cluster's nodes left).
 */
export function holdUntouched(
  result: ScheduleResult,
  current: { replicas: readonly ReplicaPlacement[]; volumes: readonly VolumePlacement[] },
  touched: TouchedWorkloads,
  volumeOwners: ReadonlyMap<string, string>,
  nodes?: ReadonlySet<string>,
): { schedule: ScheduleResult; waiting: WaitingWorkload[] } {
  const waiting: WaitingWorkload[] = [];
  const replicas = [...result.replicas];
  const placed = new Set(replicas.map((r) => r.replica));
  const unschedulable = result.unschedulable.filter((u) => {
    if (touched(u.service)) return true;

    const kept = current.replicas.filter(
      (r) =>
        r.service === u.service &&
        (!u.replica || r.replica === u.replica) &&
        !placed.has(r.replica) &&
        (!nodes || nodes.has(r.node)),
    );

    for (const r of kept) {
      replicas.push({ service: r.service, replica: r.replica, node: r.node });
      placed.add(r.replica);
    }

    waiting.push({ ...u, nodes: [...new Set(kept.map((r) => r.node))] });

    return false;
  });

  if (waiting.length === 0) return { schedule: result, waiting };

  const waitingServices = new Set(waiting.map((w) => w.service));
  const scheduled = new Set(result.volumes.map((v) => v.volume));
  // A waiting stateful service got no volume placement: its copies stay where they are.
  const volumes = [
    ...result.volumes,
    ...current.volumes.filter((v) => !scheduled.has(v.volume) && waitingServices.has(volumeOwners.get(v.volume) ?? '')),
  ];

  return { schedule: { ...result, replicas, volumes, unschedulable }, waiting };
}

/**
 * Plan notes for waiting workloads: same project / deployment / path as the placement error they replace. Extra
 * replicas of a single-writer service name the real reason (no node would ever take them).
 */
export function waitingIssues(waiting: readonly WaitingWorkload[]): DeploymentIssue[] {
  return waiting.map((w) => {
    const [project, deployment] = w.service.split('/');
    const outcome =
      w.nodes.length > 0 ? `it keeps its placement on ${w.nodes.join(', ')}` : 'it is placed once a node can run it';

    return {
      level: 'warning' as const,
      project,
      deployment,
      path: w.replica ?? w.service,
      message:
        w.cause === 'single-writer'
          ? `${w.reason}; this plan doesn't change it, the extra replica is not placed`
          : `waiting for a node (${w.reason}); this plan doesn't change it, ${outcome}`,
    };
  });
}

/**
 * Replicas a failover / drain must move but the re-plan can't place anywhere (user decision 2026-11-01): the
 * `waiting` entries (planned with `NOTHING_TOUCHED`) that cover one of `moving` — a service-level entry covers all
 * of its replicas. Sorted by replica.
 */
export function stuckReplicas(
  waiting: readonly WaitingWorkload[],
  moving: ReadonlySet<string>,
): { replica: string; reason: string }[] {
  return [...moving].sort().flatMap((replica) => {
    const service = replica.split('/').slice(0, 3).join('/');
    const entry = waiting.find((w) => !w.cause && w.service === service && (!w.replica || w.replica === replica));

    return entry ? [{ replica, reason: entry.reason }] : [];
  });
}
