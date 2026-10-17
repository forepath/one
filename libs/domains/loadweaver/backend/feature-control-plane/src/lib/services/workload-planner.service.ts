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
  type WorkloadChange,
  volumeId,
} from '../utils/workload-planning.utils';

/** DRBD minors / ports for Loadweaver volumes (ports stay inside DRBD's usual range). */
export const DRBD_MINOR_BASE = 1000;
export const DRBD_PORT_BASE = 7800;
export const DRBD_MAX_VOLUMES = 10_000;

export interface WorkloadPlan {
  parsed: ParsedDeployment[];
  issues: DeploymentIssue[];
  schedule: ScheduleResult;
  analysis: FailureAnalysis;
  changes: WorkloadChange[];
  statefulServices: Set<string>;
}

/**
 * Addresses that new allocations must not take (per node): blue / green targets, cron runs, and running copies of
 * placements that are not part of `keep` (they are released only when the placement is gone).
 */
export function reservedAddresses(
  placements: readonly Pick<
    WorkloadPlacementEntity,
    'id' | 'node' | 'addresses' | 'targetNode' | 'targetAddresses' | 'cronRun'
  >[],
  keep: ReadonlySet<string> = new Set(),
): Map<string, string[]> {
  const reserved = new Map<string, string[]>();
  const add = (node: string, addresses: readonly string[]) =>
    reserved.set(node, [...(reserved.get(node) ?? []), ...addresses]);

  for (const p of placements) {
    if (p.targetNode) add(p.targetNode, p.targetAddresses ?? []);

    if (p.cronRun || !keep.has(p.id)) add(p.node, p.addresses);
  }

  return reserved;
}

function keepAddressesOf(placements: readonly WorkloadPlacementEntity[], plan: WorkloadPlan): Set<string> {
  // Replicas staying on their node are seeded from `existing`; moved or removed ones keep their old addresses
  // reserved while their container may still run there (migrations, stopping).
  const planned = new Map(plan.schedule.replicas.map((r) => [r.replica, r.node]));

  return new Set(placements.filter((p) => !p.cronRun && planned.get(p.id) === p.node).map((p) => p.id));
}

export function plannerNodes(nodes: NodeEntity[], now = Date.now()): PlannerNode[] {
  return nodes.map((n) => ({
    name: n.name,
    site: n.site,
    labels: n.labels ?? {},
    lifecycle: n.lifecycle,
    witness: n.witness,
    controlPlane: n.controlPlane,
    capacity: n.capacity,
    runtimes: ((n.capabilities?.['runtimes'] as string[] | undefined) ?? ['runc']).slice(),
    reachable: !!n.lastSeenAt && now - n.lastSeenAt.getTime() <= NODE_HEARTBEAT_TIMEOUT_MS,
  }));
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

  async plan(
    manager: EntityManager,
    resources: readonly ResourceEntity[],
    nodeOverrides?: NodeEntity[],
  ): Promise<WorkloadPlan> {
    const { parsed, issues } = this.parse(resources);
    const clusterResource = resources.find((r) => r.kind === 'Cluster');
    const cluster: ClusterSpec | null = clusterResource ? clusterSpecSchema.parse(clusterResource.spec) : null;
    const nodes =
      nodeOverrides ??
      (await manager.getRepository(NodeEntity).find({ where: { lifecycle: Not('left') }, order: { name: 'ASC' } }));
    const current = await this.current(manager);
    const schedulerNodes = toSchedulerNodes(plannerNodes(nodes));
    const services = toSchedulerServices(parsed);
    const result = schedule({ nodes: schedulerNodes, services, current });
    const statefulServices = new Set(services.filter((s) => s.volumes.length > 0).map((s) => s.id));

    return {
      parsed,
      issues,
      schedule: result,
      analysis: analyzeFailures(schedulerNodes, services, result, cluster?.failureDomain ?? 'node'),
      changes: diffPlacements(current.replicas, result.replicas, statefulServices),
      statefulServices,
    };
  }

  async current(manager: EntityManager): Promise<{ replicas: ReplicaPlacement[]; volumes: VolumePlacement[] }> {
    // Cron runs are owned by the cron controller (3.23), not by plans.
    const replicas = await manager.getRepository(WorkloadPlacementEntity).find({ where: { cronRun: IsNull() } });
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
   * Persists placements inside the apply transaction. Moves from a reachable node become migrations (3.10):
   * blue / green for stateless replicas, short stop for stateful ones; a failover (source gone) moves directly.
   */
  async persist(
    manager: EntityManager,
    plan: WorkloadPlan,
    network: ClusterSpec['network'],
    mode: 'plan' | 'drain' | 'failover' = 'plan',
  ): Promise<void> {
    await manager.query('SELECT pg_advisory_xact_lock($1)', [ADVISORY_LOCK_PLACEMENT_ALLOCATION]);

    const nodes = await manager.getRepository(NodeEntity).find({ where: { lifecycle: Not('left') } });
    const podSubnets = new Map(
      nodes.map((n) => [n.name, [n.podSubnetV4, n.podSubnetV6].filter((s): s is string => !!s)]),
    );
    const placementRepo = manager.getRepository(WorkloadPlacementEntity);
    const all = await placementRepo.find();
    const existing = all.filter((p) => !p.cronRun);
    const addresses = allocateWorkloadAddresses(
      plan.schedule.replicas,
      podSubnets,
      new Map(existing.map((p) => [p.id, { node: p.node, addresses: p.addresses }])),
      reservedAddresses(all, keepAddressesOf(all, plan)),
    );
    const keep = new Set(plan.schedule.replicas.map((r) => r.replica));

    for (const stale of existing.filter((p) => !keep.has(p.id))) await placementRepo.delete({ id: stale.id });

    const migrating = new Map<string, { from: string; to: string }>();

    for (const replica of plan.schedule.replicas) {
      const [project, deployment, service] = replica.replica.split('/');
      const previous = existing.find((p) => p.id === replica.replica);
      const moved = !!previous && previous.node !== replica.node;
      const stateful = plan.statefulServices.has(replica.service);

      // Already migrating to this target: keep the migration and its start time.
      if (moved && previous?.targetNode === replica.node && previous.migration && mode !== 'failover') {
        migrating.set(replica.service, { from: previous.node, to: replica.node });
        continue;
      }

      if (moved && mode !== 'failover' && previous) {
        migrating.set(replica.service, { from: previous.node, to: replica.node });
        await placementRepo.save(
          Object.assign(previous, {
            targetNode: replica.node,
            targetAddresses: addresses.get(replica.replica) ?? [],
            migration: {
              method: stateful ? ('short-stop' as const) : ('blue-green' as const),
              phase: stateful ? ('stopping' as const) : ('starting' as const),
              reason: mode === 'drain' ? ('drain' as const) : ('plan' as const),
              startedAt: new Date().toISOString(),
            },
          }),
        );
        continue;
      }

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
        }),
      );
    }
    // Volumes of removed deployments keep their placement: data is never dropped by a plan (3.2); deleting
    // volumes is an explicit, separately confirmed action.
  }
}
