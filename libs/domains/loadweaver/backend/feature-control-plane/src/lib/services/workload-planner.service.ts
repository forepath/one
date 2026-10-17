import {
  clusterSpecSchema,
  deploymentSpecSchema,
  projectSpecSchema,
  type ClusterSpec,
  type ProjectSpec,
} from '@forepath/loadweaver/shared/util-model';
import {
  analyzeFailures,
  schedule,
  type FailureAnalysis,
  type ReplicaPlacement,
  type ScheduleResult,
  type VolumePlacement,
} from '@forepath/loadweaver/shared/util-scheduler';
import { Injectable } from '@nestjs/common';
import { EntityManager, IsNull, Not } from 'typeorm';

import { ADVISORY_LOCK_PLACEMENT_ALLOCATION, NODE_HEARTBEAT_TIMEOUT_MS } from '../constants/control-plane.constants';
import { NodeEntity } from '../entities/node.entity';
import { NodeDesiredStateEntity } from '../entities/node-desired-state.entity';
import { ResourceEntity } from '../entities/resource.entity';
import { ServiceAddressEntity } from '../entities/service-address.entity';
import { VolumePlacementEntity } from '../entities/volume-placement.entity';
import { WorkloadPlacementEntity } from '../entities/workload-placement.entity';
import {
  allocateServiceAddresses,
  allocateWorkloadAddresses,
  diffPlacements,
  serviceId,
  toSchedulerNodes,
  toSchedulerServices,
  translateDeployments,
  type DeploymentIssue,
  type ParsedDeployment,
  type PlannerNode,
  type VolumeCopyChange,
  type WorkloadChange,
  volumeCopyChanges,
  volumeId,
} from '../utils/workload-planning.utils';
import {
  legacyEgressPlacementIssues,
  unfoldableEgressServices,
  withEgressFeatureRequirements,
} from '../utils/egress-steering.utils';
import {
  chooseMigrationMethod,
  eligibilityOptionsFromEnv,
  type EligibilityNode,
  type MigrationChoice,
} from '../utils/migration-eligibility.utils';
import { keptAddresses, subnetOwner, waveDependencies } from '../utils/migration-state.utils';
import { assignDrbdNodeIds, drbd9Capability } from '../utils/drbd-volumes.utils';
import { drainDeadline, isDraining, removalAction } from '../utils/replica-drain.utils';
import { nodeNotReady } from '../utils/node-readiness.utils';
import { beginAttempt, finishAttempt, isCheckpointMethod, runningSpec } from './migration-records';
import { applyAutoscaledReplicas, type AutoscaledService } from '../autoscaling/autoscale.utils';

/** DRBD minors / ports for Loadweaver volumes (ports stay inside DRBD's usual range). */
export const DRBD_MINOR_BASE = 1000;
export const DRBD_PORT_BASE = 7800;
export const DRBD_MAX_VOLUMES = 10_000;

export interface WorkloadPlan {
  parsed: ParsedDeployment[];
  issues: DeploymentIssue[];
  schedule: ScheduleResult;
  analysis: FailureAnalysis;
  /** Replica starts, stops and moves, then the volume copies added to existing volumes (M6 gate). */
  changes: (WorkloadChange | VolumeCopyChange)[];
  statefulServices: Set<string>;
  /** Migration method per moving replica (3.10), as the plan shows it. */
  choices: Map<string, MigrationChoice>;
  /** Autoscaled services (3.23) at the autoscaler's current counts. */
  autoscaled: AutoscaledService[];
}

/** A replica changing nodes. */
export interface ReplicaMove {
  replica: string;
  service: string;
  from: string;
  to: string;
}

/**
 * Addresses that new allocations must not take (per node): blue / green targets, cron runs, and running copies of
 * placements that are not part of `keep` (they are released only when the placement is gone). Addresses kept by
 * live-migrated replicas (3.10) stay reserved on the node whose pod subnet they belong to, wherever they run.
 */
export function reservedAddresses(
  placements: readonly Pick<
    WorkloadPlacementEntity,
    'id' | 'node' | 'addresses' | 'targetNode' | 'targetAddresses' | 'cronRun'
  >[],
  keep: ReadonlySet<string> = new Set(),
  podSubnets: ReadonlyMap<string, readonly string[]> = new Map(),
): Map<string, string[]> {
  const reserved = new Map<string, string[]>();
  const add = (node: string, addresses: readonly string[]) =>
    reserved.set(node, [...(reserved.get(node) ?? []), ...addresses]);

  for (const p of placements) {
    if (p.targetNode) add(p.targetNode, p.targetAddresses ?? []);

    if (p.cronRun || !keep.has(p.id)) add(p.node, p.addresses);

    if (podSubnets.has(p.node))
      for (const address of keptAddresses(p.addresses, podSubnets.get(p.node) ?? [])) {
        const owner = subnetOwner(address, podSubnets);

        if (owner) add(owner, [address]);
      }
  }

  return reserved;
}

/** Pod subnets per node. */
export function podSubnetsOf(
  nodes: readonly Pick<NodeEntity, 'name' | 'podSubnetV4' | 'podSubnetV6'>[],
): Map<string, string[]> {
  return new Map(nodes.map((n) => [n.name, [n.podSubnetV4, n.podSubnetV6].filter((s): s is string => !!s)]));
}

/** Latest measured memory per replica (`replica.memory_bytes`, last 15 minutes); empty when there are no metrics. */
async function replicaMemory(manager: EntityManager, replicas: readonly string[]): Promise<Map<string, number>> {
  if (replicas.length === 0) return new Map();

  try {
    const rows: { entity: string; value: number }[] = await manager.query(
      `SELECT DISTINCT ON (entity) entity, value FROM lw_metrics
        WHERE metric = 'replica.memory_bytes' AND entity = ANY($1) AND "time" > now() - INTERVAL '15 minutes'
        ORDER BY entity, "time" DESC`,
      [replicas],
    );

    return new Map(rows.map((r) => [r.entity, Number(r.value)]));
  } catch {
    return new Map();
  }
}

function keepAddressesOf(placements: readonly WorkloadPlacementEntity[], plan: WorkloadPlan): Set<string> {
  // Replicas staying on their node are seeded from `existing`; moved or removed ones keep their old addresses
  // reserved while their container may still run there (migrations, stopping).
  const planned = new Map(plan.schedule.replicas.map((r) => [r.replica, r.node]));

  return new Set(placements.filter((p) => !p.cronRun && planned.get(p.id) === p.node).map((p) => p.id));
}

/**
 * The stop grace period that sets a removed replica's drain (M6 gate): from the service's compose while it exists,
 * else from the spec the replica last ran.
 */
export function stopGraceOf(
  parsed: readonly ParsedDeployment[],
  placement: Pick<WorkloadPlacementEntity, 'project' | 'deployment' | 'service' | 'releasedSpec'>,
): number | undefined {
  const spec = parsed
    .find((d) => d.project === placement.project && d.name === placement.deployment)
    ?.compose.services.find((s) => s.name === placement.service);

  return (
    spec?.stopGracePeriodMs ?? (placement.releasedSpec as { stopGracePeriodMs?: number } | null)?.stopGracePeriodMs
  );
}

/**
 * Planner view of the nodes. With `desiredRevisions` (revision of each node's stored desired state), nodes that are
 * still joining carry `notReady` and get no new volume copies (M6 gate).
 */
export function plannerNodes(
  nodes: NodeEntity[],
  now = Date.now(),
  desiredRevisions?: ReadonlyMap<string, number>,
): PlannerNode[] {
  return nodes.map((n) => ({
    name: n.name,
    site: n.site,
    labels: n.labels ?? {},
    // Import (3.21): a pending node takes nothing; one whose join plan is applied takes its imported deployments.
    lifecycle: n.lifecycle === 'pending' ? 'leaving' : n.lifecycle === 'importing' ? 'active' : n.lifecycle,
    witness: n.witness,
    controlPlane: n.controlPlane,
    capacity: n.capacity,
    runtimes: ((n.capabilities?.['runtimes'] as string[] | undefined) ?? ['runc']).slice(),
    drbd9: drbd9Capability(n),
    reachable: !!n.lastSeenAt && now - n.lastSeenAt.getTime() <= NODE_HEARTBEAT_TIMEOUT_MS,
    features: [...(n.protocolFeatures ?? [])],
    ...withNotReady(n, desiredRevisions, now),
  }));
}

function withNotReady(
  node: NodeEntity,
  desiredRevisions: ReadonlyMap<string, number> | undefined,
  now: number,
): { notReady?: string } {
  if (!desiredRevisions) return {};

  const reason = nodeNotReady(
    {
      joinedAt: node.joinedAt ?? null,
      connected: !!node.connected,
      appliedRevision: node.appliedRevision ?? 0,
      lastReportSteps: node.lastReportSteps ?? null,
      controlPlane: !!node.controlPlane,
    },
    desiredRevisions.get(node.name),
    now,
  );

  return reason ? { notReady: reason } : {};
}

/** Plan notes for volume copies held back from nodes that are still joining (M6 gate). */
export function heldVolumeIssues(held: ScheduleResult['held']): DeploymentIssue[] {
  return (held ?? []).map((h) => {
    const [project, deployment, volume] = h.volume.split('/');
    const nodes = h.nodes.map((n) => `${n.name} (${n.reason})`).join(', ');

    return {
      level: 'warning' as const,
      project,
      deployment,
      path: `volumes.${volume}`,
      message:
        h.kind === 'primary'
          ? `volume ${volume} is created on ${nodes}, the only node that fits; its apply waits until that node is ready`
          : `volume ${volume} gets no copy on ${nodes} while it is joining; plan again once the node is ready to add the copy`,
    };
  });
}

/**
 * Turns deployments into placements (3.11): parses compose, schedules replicas and volumes, analyses failures
 * (3.12) and diffs against what runs today. Used by plans (preview), applies (persist) and the network compile.
 */
@Injectable()
export class WorkloadPlannerService {
  parse(resources: readonly ResourceEntity[]): { parsed: ParsedDeployment[]; issues: DeploymentIssue[] } {
    const projects = new Map<string, ProjectSpec>(
      resources.filter((r) => r.kind === 'Project').map((r) => [r.name, projectSpecSchema.parse(r.spec)]),
    );
    const deployments = resources
      .filter((r) => r.kind === 'Deployment' && r.project)
      .map((r) => ({ project: r.project as string, name: r.name, spec: deploymentSpecSchema.parse(r.spec) }));

    return translateDeployments(deployments, projects);
  }

  /** The autoscaler's replica count per service (3.23); services it never scaled are missing. */
  async autoscaleCounts(manager: EntityManager): Promise<Map<string, number>> {
    const rows: { service_key: string; replicas: number }[] = await manager.query(
      `SELECT service_key, replicas FROM lw_autoscale_state`,
    );

    return new Map(rows.map((r) => [r.service_key, Number(r.replicas)]));
  }

  /** `parse`, with autoscaled services at the autoscaler's counts instead of their compose `replicas` (3.23). */
  async parseAutoscaled(
    manager: EntityManager,
    resources: readonly ResourceEntity[],
  ): Promise<{ parsed: ParsedDeployment[]; issues: DeploymentIssue[]; autoscaled: AutoscaledService[] }> {
    const { parsed, issues } = this.parse(resources);
    const autoscaled = applyAutoscaledReplicas(parsed, await this.autoscaleCounts(manager));

    return { parsed, issues, autoscaled };
  }

  async plan(
    manager: EntityManager,
    resources: readonly ResourceEntity[],
    nodeOverrides?: NodeEntity[],
  ): Promise<WorkloadPlan> {
    const { parsed, issues, autoscaled } = await this.parseAutoscaled(manager, resources);
    const clusterResource = resources.find((r) => r.kind === 'Cluster');
    const cluster: ClusterSpec | null = clusterResource ? clusterSpecSchema.parse(clusterResource.spec) : null;
    const nodes =
      nodeOverrides ??
      (await manager.getRepository(NodeEntity).find({ where: { lifecycle: Not('left') }, order: { name: 'ASC' } }));
    const current = await this.current(manager);
    // Nodes still joining get no new volume copies (M6 gate): readiness from their desired-state revisions.
    const desiredRevisions = new Map(
      (await manager.getRepository(NodeDesiredStateEntity).find({ select: { nodeName: true, revision: true } })).map(
        (d) => [d.nodeName, d.revision] as const,
      ),
    );
    const schedulerNodes = toSchedulerNodes(plannerNodes(nodes, Date.now(), desiredRevisions));
    // Per-source egress settings older agents can't apply: new replicas only on nodes with `egress-policies` (M6 gate).
    const unfoldable = unfoldableEgressServices(parsed, resources);
    const services = withEgressFeatureRequirements(toSchedulerServices(parsed), unfoldable);
    const result = schedule({ nodes: schedulerNodes, services, current });
    const statefulServices = new Set(services.filter((s) => s.volumes.length > 0).map((s) => s.id));
    const before = new Map(current.replicas.map((r) => [r.replica, r.node]));
    const moves = result.replicas
      .filter((r) => before.has(r.replica) && before.get(r.replica) !== r.node)
      .map((r) => ({ replica: r.replica, service: r.service, from: before.get(r.replica) as string, to: r.node }));
    const choices = await this.migrationChoices(manager, parsed, moves, nodes, current.volumes, statefulServices);

    return {
      parsed,
      issues: [
        ...issues,
        ...heldVolumeIssues(result.held),
        ...legacyEgressPlacementIssues(
          result.replicas,
          unfoldable,
          new Map(nodes.map((n) => [n.name, n.protocolFeatures ?? []] as const)),
        ),
      ],
      schedule: result,
      analysis: analyzeFailures(schedulerNodes, services, result, cluster?.failureDomain ?? 'node'),
      changes: [
        ...diffPlacements(current.replicas, result.replicas, statefulServices, choices),
        ...volumeCopyChanges(current.volumes, result.volumes),
      ],
      statefulServices,
      choices,
      autoscaled,
    };
  }

  /**
   * The migration method of each move (3.10): eligibility per service from both nodes' capabilities and protocol
   * features, the volumes' synchronous replicas and the replica's measured memory.
   */
  async migrationChoices(
    manager: EntityManager,
    parsed: readonly ParsedDeployment[],
    moves: readonly ReplicaMove[],
    nodes: readonly NodeEntity[],
    volumes: readonly VolumePlacement[],
    statefulServices: ReadonlySet<string>,
  ): Promise<Map<string, MigrationChoice>> {
    const choices = new Map<string, MigrationChoice>();

    if (moves.length === 0) return choices;

    const reachable = new Map(plannerNodes([...nodes]).map((n) => [n.name, n.reachable]));
    const eligibility = new Map<string, EligibilityNode>(
      nodes.map((n) => [
        n.name,
        {
          name: n.name,
          features: n.protocolFeatures ?? [],
          capabilities: n.capabilities,
          reachable: reachable.get(n.name) ?? false,
        },
      ]),
    );
    const memory = await replicaMemory(
      manager,
      moves.map((m) => m.replica),
    );
    const volumePlacements = new Map(volumes.map((v) => [v.volume, v]));
    const options = eligibilityOptionsFromEnv();

    for (const move of moves) {
      const [project, deployment, service] = move.service.split('/');
      const spec = parsed
        .find((d) => d.project === project && d.name === deployment)
        ?.compose.services.find((s) => s.name === service);

      if (!spec) continue;

      const volumeIds = spec.volumes
        .filter((m): m is Extract<typeof m, { type: 'volume' }> => m.type === 'volume')
        .map((m) => volumeId(project, deployment, m.source));

      choices.set(
        move.replica,
        chooseMigrationMethod(
          {
            service: spec,
            stateful: statefulServices.has(move.service),
            unsyncedVolumes: volumeIds.filter((id) => !volumePlacements.get(id)?.syncReplicas.includes(move.to)),
            source: eligibility.get(move.from),
            target: eligibility.get(move.to),
            ...(memory.has(move.replica) ? { memoryBytes: memory.get(move.replica) } : {}),
          },
          options,
        ),
      );
    }

    return choices;
  }

  /** Volume ids of a service (`project/deployment/service`). */
  serviceVolumes(parsed: readonly ParsedDeployment[], service: string): string[] {
    return toSchedulerServices(parsed)
      .filter((s) => s.id === service)
      .flatMap((s) => s.volumes.map((v) => v.id));
  }

  /**
   * New addresses for a replica on `node` (a live attempt that fell back gets an address of the target's own pod
   * subnet), taken under the allocation lock and avoiding every address in use.
   */
  async allocateOn(manager: EntityManager, replica: string, service: string, node: string): Promise<string[]> {
    await manager.query('SELECT pg_advisory_xact_lock($1)', [ADVISORY_LOCK_PLACEMENT_ALLOCATION]);

    const nodes = await manager.getRepository(NodeEntity).find({ where: { lifecycle: Not('left') } });
    const podSubnets = podSubnetsOf(nodes);
    const all = await manager.getRepository(WorkloadPlacementEntity).find();

    return (
      allocateWorkloadAddresses(
        [{ replica, service, node }],
        podSubnets,
        new Map(),
        reservedAddresses(all, new Set(), podSubnets),
      ).get(replica) ?? []
    );
  }

  async current(manager: EntityManager): Promise<{ replicas: ReplicaPlacement[]; volumes: VolumePlacement[] }> {
    // Cron runs are owned by the cron controller (3.23), not by plans; draining replicas are already removed.
    const replicas = await manager
      .getRepository(WorkloadPlacementEntity)
      .find({ where: { cronRun: IsNull(), drainUntil: IsNull() } });
    const volumes = await manager.getRepository(VolumePlacementEntity).find();

    return {
      replicas: replicas.map((p) => ({
        service: serviceId(p.project, p.deployment, p.service),
        replica: p.id,
        node: p.node,
      })),
      volumes: volumes.map((v) => ({
        volume: v.id,
        primary: v.primaryNode,
        syncReplicas: v.syncReplicas,
        remoteReplicas: v.remoteReplicas,
      })),
    };
  }

  /**
   * Persists placements inside the apply transaction. Moves from a reachable node become migrations (3.10) with
   * the method chosen per service (live, stop-and-copy, blue / green, short stop), in dependency waves per
   * deployment; a failover (source gone) moves directly.
   */
  async persist(
    manager: EntityManager,
    plan: WorkloadPlan,
    network: ClusterSpec['network'],
    mode: 'plan' | 'drain' | 'failover' = 'plan',
  ): Promise<void> {
    await manager.query('SELECT pg_advisory_xact_lock($1)', [ADVISORY_LOCK_PLACEMENT_ALLOCATION]);

    const nodes = await manager.getRepository(NodeEntity).find({ where: { lifecycle: Not('left') } });
    const podSubnets = podSubnetsOf(nodes);
    const placementRepo = manager.getRepository(WorkloadPlacementEntity);
    const now = new Date();
    const plannedNode = new Map(plan.schedule.replicas.map((r) => [r.replica, r.node]));
    let all = await placementRepo.find();

    // A draining replica planned again (scale back up): kept if it stays on its node (the drain ends), else its
    // drain is cut short and the replica is placed anew.
    for (const p of all.filter((x) => isDraining(x) && plannedNode.has(x.id) && plannedNode.get(x.id) !== x.node))
      await placementRepo.delete({ id: p.id });

    all = all.filter((x) => !(isDraining(x) && plannedNode.has(x.id) && plannedNode.get(x.id) !== x.node));

    const existing = all.filter((p) => !p.cronRun);
    const addresses = allocateWorkloadAddresses(
      plan.schedule.replicas,
      podSubnets,
      new Map(existing.map((p) => [p.id, { node: p.node, addresses: p.addresses }])),
      reservedAddresses(all, keepAddressesOf(all, plan), podSubnets),
    );
    const keep = new Set(plan.schedule.replicas.map((r) => r.replica));
    const liveNodes = new Set(nodes.map((n) => n.name));

    // Removed replicas drain first (M6 gate): out of routing now, stopped after their grace period.
    for (const stale of existing.filter((p) => !keep.has(p.id))) {
      await finishAttempt(manager, stale.migration?.id, 'cancelled', now, { fallbackReason: 'replica removed' });

      if (removalAction(stale, liveNodes) === 'delete') {
        await placementRepo.delete({ id: stale.id });
        continue;
      }

      if (isDraining(stale) && !stale.migration) continue;

      await placementRepo.update(
        { id: stale.id },
        {
          drainUntil: drainDeadline(stale, stopGraceOf(plan.parsed, stale), now),
          targetNode: null,
          targetAddresses: [],
          migration: null,
        },
      );
    }

    const migrating = new Map<string, { from: string; to: string }>();
    const previousOf = new Map(existing.map((p) => [p.id, p]));
    // An attempt past its queue keeps going: a checkpoint session may have frozen the source (3.10).
    const inFlight = (p: WorkloadPlacementEntity | undefined) =>
      !!p?.migration && !!p.targetNode && isCheckpointMethod(p.migration.method) && p.migration.phase !== 'queued';
    const newMoves = plan.schedule.replicas
      .filter((r) => {
        const previous = previousOf.get(r.replica);

        return (
          mode !== 'failover' &&
          !!previous &&
          previous.node !== r.node &&
          !inFlight(previous) &&
          !(previous.targetNode === r.node && previous.migration)
        );
      })
      .map((r) => ({
        replica: r.replica,
        service: r.service,
        from: previousOf.get(r.replica)?.node as string,
        to: r.node,
      }));
    const choices = new Map(plan.choices);
    const missing = newMoves.filter((m) => !choices.has(m.replica));

    if (missing.length > 0) {
      const volumes = await manager.getRepository(VolumePlacementEntity).find();

      for (const [replica, choice] of await this.migrationChoices(
        manager,
        plan.parsed,
        missing,
        nodes,
        volumes.map((v) => ({
          volume: v.id,
          primary: v.primaryNode,
          syncReplicas: v.syncReplicas,
          remoteReplicas: v.remoteReplicas,
        })),
        plan.statefulServices,
      ))
        choices.set(replica, choice);
    }

    // Dependency waves per deployment (3.10): a replica moves once those of the services it depends on moved.
    const waves = new Map<string, string[]>();

    for (const d of plan.parsed) {
      const moving = newMoves.filter((m) => m.service.startsWith(`${d.project}/${d.name}/`));

      if (moving.length < 2) continue;

      for (const [replica, after] of waveDependencies(
        new Map(d.compose.services.map((svc) => [svc.name, svc.dependsOn.map((x) => x.service)])),
        moving.map((m) => ({ replica: m.replica, service: m.service.split('/')[2] })),
      ))
        waves.set(replica, after);
    }

    for (const replica of plan.schedule.replicas) {
      const [project, deployment, service] = replica.replica.split('/');
      const previous = previousOf.get(replica.replica);
      const moved = !!previous && previous.node !== replica.node;
      const stateful = plan.statefulServices.has(replica.service);

      // Already migrating to this target, or a checkpoint attempt in flight: keep the migration and its start time.
      if (
        moved &&
        previous &&
        mode !== 'failover' &&
        (inFlight(previous) || (previous.targetNode === replica.node && previous.migration))
      ) {
        migrating.set(replica.service, { from: previous.node, to: previous.targetNode ?? replica.node });
        continue;
      }

      if (moved && mode !== 'failover' && previous) {
        let choice: MigrationChoice = choices.get(replica.replica) ?? {
          method: stateful ? 'short-stop' : 'blue-green',
          label: stateful ? 'short-stop' : 'blue-green',
        };
        const spec = isCheckpointMethod(choice.method) ? await runningSpec(manager, previous.node, previous.id) : null;

        if (isCheckpointMethod(choice.method) && !spec) {
          const method = stateful ? 'short-stop' : 'blue-green';

          choice = {
            method,
            reason: 'nothing running on the source yet',
            label: `${method} (nothing running on the source yet)`,
          };
        }

        const checkpoint = isCheckpointMethod(choice.method);
        const after = waves.get(replica.replica) ?? [];

        // A different migration of this replica is replaced: its attempt ends.
        await finishAttempt(manager, previous.migration?.id, 'cancelled', now, {
          fallbackReason: 'replaced by a new plan',
        });
        migrating.set(replica.service, { from: previous.node, to: replica.node });
        Object.assign(previous, {
          targetNode: replica.node,
          // Live migration keeps the replica's addresses (3.10); the others get addresses on the target.
          targetAddresses: checkpoint ? previous.addresses : (addresses.get(replica.replica) ?? []),
          migration: {
            method: choice.method,
            phase: after.length > 0 ? 'queued' : checkpoint ? 'prepare' : stateful ? 'stopping' : 'starting',
            reason: mode === 'drain' ? 'drain' : 'plan',
            startedAt: now.toISOString(),
            label: choice.label,
            ...(after.length > 0 ? { after } : {}),
            ...(choice.runtime ? { runtime: choice.runtime } : {}),
          },
        });

        if (after.length === 0)
          await beginAttempt(manager, previous, {
            volumes: this.serviceVolumes(plan.parsed, replica.service),
            spec,
            now,
          });

        await placementRepo.save(previous);
        continue;
      }

      if (moved && previous?.migration)
        await finishAttempt(manager, previous.migration.id, 'cancelled', now, { fallbackReason: 'moved by failover' });

      await placementRepo.save(
        placementRepo.create({
          id: replica.replica,
          project,
          deployment,
          service,
          node: replica.node,
          addresses: addresses.get(replica.replica) ?? [],
          targetNode: moved ? null : (previous?.targetNode ?? null),
          targetAddresses: moved ? [] : (previous?.targetAddresses ?? []),
          migration: moved ? null : (previous?.migration ?? null),
          restored: moved ? null : (previous?.restored ?? null),
          // Planned again on its node: a drain ends, the replica stays.
          drainUntil: null,
          specHash: previous?.specHash ?? null,
          status: previous && previous.node === replica.node ? previous.status : null,
        }),
      );
    }

    // Service IPs stay for as long as the service exists.
    const serviceRepo = manager.getRepository(ServiceAddressEntity);
    const currentServices = await serviceRepo.find();
    const wantedServices = plan.parsed.flatMap((d) =>
      d.compose.services.map((s) => serviceId(d.project, d.name, s.name)),
    );
    const serviceAddresses = allocateServiceAddresses(
      wantedServices,
      network,
      new Map(currentServices.map((s) => [s.id, { v4: s.addressV4, v6: s.addressV6 }])),
    );

    for (const stale of currentServices.filter((s) => !wantedServices.includes(s.id)))
      await serviceRepo.delete({ id: stale.id });

    for (const [id, a] of serviceAddresses) {
      if (!currentServices.some((s) => s.id === id))
        await serviceRepo.save(serviceRepo.create({ id, addressV4: a.v4, addressV6: a.v6 }));
    }

    await this.persistVolumes(manager, plan, migrating);
  }

  private async persistVolumes(
    manager: EntityManager,
    plan: WorkloadPlan,
    migrating: ReadonlyMap<string, { from: string; to: string }>,
  ): Promise<void> {
    const repo = manager.getRepository(VolumePlacementEntity);
    const existing = await repo.find();
    const usedMinors = new Set(existing.map((v) => v.drbdMinor));
    const volumeOwners = new Map(
      toSchedulerServices(plan.parsed).flatMap((svc) => svc.volumes.map((v): [string, string] => [v.id, svc.id])),
    );
    const sizes = new Map(
      plan.parsed.flatMap((d) =>
        d.compose.volumes.map((v): [string, typeof v] => [volumeId(d.project, d.name, v.name), v]),
      ),
    );

    for (const placement of plan.schedule.volumes) {
      const volume = sizes.get(placement.volume);
      const previous = existing.find((v) => v.id === placement.volume);
      let minor = previous?.drbdMinor;

      if (minor === undefined) {
        minor = DRBD_MINOR_BASE;

        while (usedMinors.has(minor)) minor++;

        if (minor >= DRBD_MINOR_BASE + DRBD_MAX_VOLUMES) throw new Error('no free DRBD minor numbers');

        usedMinors.add(minor);
      }

      // A short-stop migration keeps the current primary until the workload stopped there (3.10).
      const owner = volumeOwners.get(placement.volume);
      const move = owner ? migrating.get(owner) : undefined;
      const primaryNode = move ? move.from : placement.primary;
      const syncReplicas = move
        ? [...new Set([...placement.syncReplicas, placement.primary])].filter((n) => n !== move.from)
        : placement.syncReplicas;
      // DRBD node ids stay with their nodes; new holders (moves, added replicas) get fresh ones (3.5).
      const drbd = assignDrbdNodeIds(
        [...new Set([primaryNode, ...syncReplicas, ...placement.remoteReplicas])],
        previous?.drbdNodeIds ?? {},
        previous?.drbdNextNodeId ?? 0,
      );

      await repo.save(
        repo.create({
          id: placement.volume,
          primaryNode,
          pendingPrimary: move ? placement.primary : null,
          syncReplicas,
          remoteReplicas: placement.remoteReplicas,
          sizeBytes: String(volume?.sizeBytes ?? previous?.sizeBytes ?? 0),
          crossSite: volume?.crossSite ?? previous?.crossSite ?? 'async',
          drbdMinor: minor,
          drbdPort: DRBD_PORT_BASE + (minor - DRBD_MINOR_BASE),
          drbdNodeIds: drbd.ids,
          drbdNextNodeId: drbd.next,
        }),
      );
    }
    // Volumes of removed deployments keep their placement: data is never dropped by a plan (3.2); deleting
    // volumes is an explicit, separately confirmed action.
  }
}
