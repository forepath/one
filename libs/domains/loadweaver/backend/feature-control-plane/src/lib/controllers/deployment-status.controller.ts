import { RequireScopes, type RequestWithUser } from '@forepath/identity/backend';
import { installedAppOf, type InstalledAppMetadata } from '@forepath/loadweaver/shared/util-model';
import { Controller, Get, NotFoundException, Param, Req } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Like } from 'typeorm';

import { ProjectAccessService } from '../access/project-access.service';
import { AppTakedownFlagEntity } from '../app-store/app-store.entities';
import { NodeEntity } from '../entities/node.entity';
import { ResourceEntity } from '../entities/resource.entity';
import { ServiceAddressEntity } from '../entities/service-address.entity';
import { WorkloadPlacementEntity } from '../entities/workload-placement.entity';
import { NodeNamePipe } from '../utils/name.pipe';
import { isDraining } from '../utils/replica-drain.utils';
import { plannerNodes } from '../services/workload-planner.service';

export interface DeploymentStatusDto {
  project: string;
  deployment: string;
  /** Long-running replicas (cron runs excluded) with their node, addresses and the node's last report. */
  replicas: {
    id: string;
    service: string;
    node: string;
    addresses: string[];
    /**
     * `running`, `starting`, `exited`, ... as reported by the node; `pending` before its first report; `draining` once
     * the replica was removed (scale-down, deleted service): out of routing, stopped at `drainUntil` (M6 gate).
     */
    state: string;
    /** Set while draining: when the replica is stopped (ISO 8601). */
    drainUntil?: string;
    exitCode?: number;
    /** The node's message; `waiting for a node (…)` while the replica's node can't run workloads. */
    message?: string;
  }[];
  /** Service addresses (stable across replicas, migrations and failover). */
  services: { name: string; addressV4: string | null; addressV6: string | null }[];
  /**
   * Installed from the app store (P1): where it came from, and the takedown flag when its catalog took this app
   * (version) down (the console's badge; the inbox has the warning).
   */
  app?: InstalledAppMetadata & { takedown: { reason: string; at: string } | null };
}

/**
 * Why replicas on each node wait for a node (user decision 2026-11-01): the node can't run workloads now (unreachable,
 * cordoned, draining, left), and plans that don't touch the workload keep it there until one can. Nodes running
 * workloads (and unknown ones) are missing.
 */
export function nodeWaitReasons(nodes: NodeEntity[], now = Date.now()): Map<string, string> {
  const reasons = new Map<string, string>();

  for (const node of plannerNodes(nodes, now)) {
    const lifecycle = nodes.find((n) => n.name === node.name)?.lifecycle ?? node.lifecycle;

    if (lifecycle === 'left') reasons.set(node.name, `node ${node.name} left the cluster`);
    else if (node.lifecycle !== 'active') reasons.set(node.name, `node ${node.name} is ${lifecycle}`);
    else if (!node.reachable) reasons.set(node.name, `node ${node.name} is unreachable`);
  }

  return reasons;
}

/**
 * One replica of `DeploymentStatusDto`: the node's last report, or `draining` for a removed replica (M6 gate).
 * `waitReason`: its node can't run workloads (`nodeWaitReasons`); the replica waits for a node.
 */
export function replicaStatus(
  p: Pick<WorkloadPlacementEntity, 'id' | 'service' | 'node' | 'addresses' | 'status' | 'drainUntil'>,
  waitReason?: string,
): DeploymentStatusDto['replicas'][number] {
  const report = p.status?.[p.node];
  const draining = isDraining(p);
  const message = !draining && waitReason ? `waiting for a node (${waitReason})` : report?.message;

  return {
    id: p.id,
    service: p.service,
    node: p.node,
    addresses: p.addresses,
    state: draining ? 'draining' : (report?.state ?? 'pending'),
    ...(draining ? { drainUntil: new Date(p.drainUntil as Date | string).toISOString() } : {}),
    ...(report?.exitCode !== undefined ? { exitCode: report.exitCode } : {}),
    ...(message ? { message } : {}),
  };
}

/**
 * Where a deployment runs (3.11): replicas and service addresses, for machine clients that drive deployments
 * through plans (e.g. Agenstra's agent manager reaching its environments by service address). Project members.
 */
@Controller('projects/:project/deployments')
export class DeploymentStatusController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly access: ProjectAccessService,
  ) {}

  @Get(':deployment/status')
  @RequireScopes('resources:read')
  async status(
    @Param('project', NodeNamePipe) project: string,
    @Param('deployment', NodeNamePipe) deployment: string,
    @Req() req?: RequestWithUser,
  ): Promise<DeploymentStatusDto> {
    await this.access.assertRead(req, project);

    const placements = await this.dataSource
      .getRepository(WorkloadPlacementEntity)
      .find({ where: { project, deployment, cronRun: IsNull() }, order: { id: 'ASC' } });
    const nodeNames = [...new Set(placements.map((p) => p.node))];
    const waitReasons = nodeWaitReasons(
      nodeNames.length > 0
        ? await this.dataSource.getRepository(NodeEntity).find({ where: { name: In(nodeNames) } })
        : [],
    );
    const services = await this.dataSource
      .getRepository(ServiceAddressEntity)
      .find({ where: { id: Like(`${project}/${deployment}/%`) }, order: { id: 'ASC' } });

    if (placements.length === 0 && services.length === 0) throw new NotFoundException('deployment not found');

    const [resource] = await this.dataSource
      .getRepository(ResourceEntity)
      .find({ where: { kind: 'Deployment', projectKey: project, name: deployment } });
    const app = installedAppOf(resource?.annotations);
    const [flag] = app
      ? await this.dataSource.getRepository(AppTakedownFlagEntity).find({ where: { project, deployment } })
      : [];

    return {
      project,
      deployment,
      replicas: placements.map((p) => replicaStatus(p, waitReasons.get(p.node))),
      services: services.map((s) => ({
        name: s.id.split('/')[2] ?? s.id,
        addressV4: s.addressV4,
        addressV6: s.addressV6,
      })),
      ...(app
        ? {
            app: {
              ...app,
              takedown:
                flag && flag.version === app.version
                  ? { reason: flag.reason, at: new Date(flag.takenDownAt).toISOString() }
                  : null,
            },
          }
        : {}),
    };
  }
}
