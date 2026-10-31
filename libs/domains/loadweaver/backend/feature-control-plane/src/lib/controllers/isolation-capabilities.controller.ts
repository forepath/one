import { RequireScopes, type RequestWithUser } from '@forepath/identity/backend';
import {
  KVM_RUNTIMES,
  labelsSchema,
  matchesSelector,
  RUNTIMES,
  strongestRuntime,
  type Runtime,
  type Selector,
} from '@forepath/loadweaver/shared/util-model';
import {
  canRunWorkloads,
  eligibleNodes,
  ineligibilityReason,
  type SchedulerNode,
  type SchedulerService,
} from '@forepath/loadweaver/shared/util-scheduler';
import { BadRequestException, Controller, Get, Param, Query, Req } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Not } from 'typeorm';

import { ProjectAccessService } from '../access/project-access.service';
import { NodeEntity } from '../entities/node.entity';
import { ResourceEntity } from '../entities/resource.entity';
import { kvmOptOutNodes, plannerNodes } from '../services/workload-planner.service';
import { NodeNamePipe } from '../utils/name.pipe';
import { toSchedulerNodes } from '../utils/workload-planning.utils';

/** States of a level in the aggregated view (Agenstra's names; a node's `installation-failed` counts as `probe-failed`). */
export type AggregatedIsolationState = 'ready' | 'unsupported' | 'probe-failed' | 'disabled-by-admin';

export interface IsolationLevelCapabilityDto {
  /** `ready`: at least one schedulable node in the placement has the level ready; else the most common other state. */
  state: AggregatedIsolationState;
  /** Schedulable nodes in the placement with the level ready (that would accept a replica of the level). */
  nodes: number;
  /** Agenstra's reason code of the most common cause (e.g. `E_KVM_UNAVAILABLE`); only when not ready. */
  reasonCode?: string;
  /** Per-node causes, e.g. `no eligible node (runtime microvm: 0 of 3 nodes ready — n1 E_KVM_UNAVAILABLE, …)`. */
  reason?: string;
}

export interface IsolationCapabilitiesDto {
  project: string;
  /** The request selector (`key=value,…`), `null` without one. */
  selector: string | null;
  /** Schedulable nodes in the placement (active, reachable, no witness, matching the selector). */
  nodes: number;
  /** Strongest ready level (the "at least" order, for display; workloads always run at exactly their level). */
  strongest: Runtime | null;
  levels: Record<Runtime, IsolationLevelCapabilityDto>;
  checkedAt: string;
}

const REASON_MAX = 512;
/** Tie-break of equally common non-ready states: the transient one first (it may recover on its own). */
const STATE_ORDER: readonly AggregatedIsolationState[] = ['probe-failed', 'unsupported', 'disabled-by-admin'];

/**
 * A request selector `key=value[,key=value]` (labels as on nodes, incl. the derived `loadweaver.com/site` / `node` /
 * runtime labels). Empty: no selector. Anything else is a `400`.
 */
export function parseSelectorQuery(query: string | undefined): Selector | null {
  const trimmed = query?.trim();

  if (!trimmed) return null;

  const labels: Record<string, string> = {};

  for (const part of trimmed.split(',')) {
    const eq = part.indexOf('=');

    if (eq <= 0) throw new BadRequestException('selector must be key=value[,key=value]');

    labels[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }

  const parsed = labelsSchema.safeParse(labels);

  if (!parsed.success) throw new BadRequestException('selector has invalid label keys or values');

  return { matchLabels: parsed.data };
}

/** Why one node doesn't offer `level` (state + Agenstra reason code). */
function nodeCause(node: SchedulerNode, level: Runtime): { state: AggregatedIsolationState; reasonCode: string } {
  const kvmLevel = KVM_RUNTIMES.includes(level);

  if (kvmLevel && node.kvm?.optOut) return { state: 'disabled-by-admin', reasonCode: 'E_DISABLED_BY_ADMIN' };

  const probe = node.isolation?.[level];

  if (probe && probe.state !== 'ready')
    return {
      state:
        probe.state === 'unsupported' || probe.state === 'disabled-by-admin' ? probe.state : ('probe-failed' as const),
      reasonCode: probe.reasonCode ?? (probe.state === 'disabled-by-admin' ? 'E_DISABLED_BY_ADMIN' : 'E_PROBE_FAILED'),
    };

  // KVM not usable (or not reported where the level is missing).
  if (kvmLevel && (node.kvm?.usable === false || (node.kvm?.usable !== true && !node.runtimes.includes(level))))
    return { state: 'unsupported', reasonCode: 'E_KVM_UNAVAILABLE' };

  // Ready on the node but its agent lacks the protocol features, or the level isn't reported at all.
  return { state: 'unsupported', reasonCode: 'E_RUNTIME_NOT_REGISTERED' };
}

function mostCommon<T extends string>(values: readonly T[], order: readonly T[] = []): T {
  const counts = new Map<T, number>();

  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);

  return [...counts.entries()].sort(
    (a, b) =>
      b[1] - a[1] ||
      (order.indexOf(a[0]) === -1 ? order.length : order.indexOf(a[0])) -
        (order.indexOf(b[0]) === -1 ? order.length : order.indexOf(b[0])) ||
      a[0].localeCompare(b[0]),
  )[0][0];
}

/**
 * The per-level capability view of a placement (Loadweaver plan 3.35, Agenstra on Loadweaver): a level is `ready`
 * when the scheduler would place a replica of it on at least one node (same funnel as plans, ignoring capacity:
 * lifecycle, selector, the exact level, KVM, refuse-gated agent features); otherwise the most common cause among the
 * placement's nodes, with the scheduler's per-node reason.
 */
export function aggregateIsolationCapabilities(
  project: string,
  nodes: readonly SchedulerNode[],
  selector: Selector | null,
): Omit<IsolationCapabilitiesDto, 'selector' | 'checkedAt'> {
  const placement = nodes.filter(
    (n) => canRunWorkloads(n) && (!selector || matchesSelector(selector, { name: n.name, labels: n.labels })),
  );
  const levels = {} as Record<Runtime, IsolationLevelCapabilityDto>;

  for (const level of RUNTIMES) {
    const service: SchedulerService = {
      id: `${project}/isolation-capabilities/${level}`,
      project,
      replicas: 1,
      requests: { cpuMillis: 0, memoryBytes: 0 },
      runtime: level,
      ...(selector ? { selector } : {}),
      spread: 'node',
      volumes: [],
    };
    const ready = eligibleNodes(service, nodes).length;

    if (ready > 0) {
      levels[level] = { state: 'ready', nodes: ready };
      continue;
    }

    const reason = (ineligibilityReason(service, nodes) ?? `no eligible node (runtime ${level})`).slice(0, REASON_MAX);

    if (placement.length === 0) {
      levels[level] = { state: 'unsupported', nodes: 0, reasonCode: 'E_DOCKER_BASELINE_UNAVAILABLE', reason };
      continue;
    }

    const causes = placement.map((n) => nodeCause(n, level));
    const state = mostCommon(
      causes.map((c) => c.state),
      STATE_ORDER,
    );
    const reasonCode = mostCommon(causes.filter((c) => c.state === state).map((c) => c.reasonCode));

    levels[level] = { state, nodes: 0, reasonCode, reason };
  }

  return {
    project,
    nodes: placement.length,
    strongest: strongestRuntime(RUNTIMES.filter((r) => levels[r].state === 'ready')),
    levels,
  };
}

/**
 * Aggregated isolation capabilities of a project's placement (Loadweaver plan 3.35): which of the four levels
 * (`runc`, `sandboxed`, `sandboxed-kvm`, `microvm`) at least one schedulable node offers. For machine clients that
 * pick a level before they plan, e.g. Agenstra's agent manager reporting its isolation capabilities with its
 * project-scoped service PAT. Project members; scope `resources:read`.
 */
@Controller('projects/:project/isolation-capabilities')
export class IsolationCapabilitiesController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly access: ProjectAccessService,
  ) {}

  @Get()
  @RequireScopes('resources:read')
  async get(
    @Param('project', NodeNamePipe) project: string,
    @Query('selector') selectorQuery?: string,
    @Req() req?: RequestWithUser,
  ): Promise<IsolationCapabilitiesDto> {
    await this.access.assertRead(req, project);

    const selector = parseSelectorQuery(selectorQuery);
    const [nodes, nodeResources] = await Promise.all([
      this.dataSource.getRepository(NodeEntity).find({ where: { lifecycle: Not('left') }, order: { name: 'ASC' } }),
      this.dataSource
        .getRepository(ResourceEntity)
        .find({ where: { kind: 'Node' }, select: { kind: true, name: true, spec: true } }),
    ]);
    const schedulerNodes = toSchedulerNodes(plannerNodes(nodes, Date.now(), undefined, kvmOptOutNodes(nodeResources)));

    return {
      ...aggregateIsolationCapabilities(project, schedulerNodes, selector),
      selector: selectorQuery?.trim() || null,
      checkedAt: new Date().toISOString(),
    };
  }
}
