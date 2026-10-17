import { RequireScopes, type RequestWithUser } from '@forepath/identity/backend';
import { Controller, Get, NotFoundException, Param, Req } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, IsNull, Like } from 'typeorm';

import { ProjectAccessService } from '../access/project-access.service';
import { ServiceAddressEntity } from '../entities/service-address.entity';
import { WorkloadPlacementEntity } from '../entities/workload-placement.entity';
import { NodeNamePipe } from '../utils/name.pipe';
import { isDraining } from '../utils/replica-drain.utils';

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
    message?: string;
  }[];
  /** Service addresses (stable across replicas, migrations and failover). */
  services: { name: string; addressV4: string | null; addressV6: string | null }[];
}

/** One replica of `DeploymentStatusDto`: the node's last report, or `draining` for a removed replica (M6 gate). */
export function replicaStatus(
  p: Pick<WorkloadPlacementEntity, 'id' | 'service' | 'node' | 'addresses' | 'status' | 'drainUntil'>,
): DeploymentStatusDto['replicas'][number] {
  const report = p.status?.[p.node];
  const draining = isDraining(p);

  return {
    id: p.id,
    service: p.service,
    node: p.node,
    addresses: p.addresses,
    state: draining ? 'draining' : (report?.state ?? 'pending'),
    ...(draining ? { drainUntil: new Date(p.drainUntil as Date | string).toISOString() } : {}),
    ...(report?.exitCode !== undefined ? { exitCode: report.exitCode } : {}),
    ...(report?.message ? { message: report.message } : {}),
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
    const services = await this.dataSource
      .getRepository(ServiceAddressEntity)
      .find({ where: { id: Like(`${project}/${deployment}/%`) }, order: { id: 'ASC' } });

    if (placements.length === 0 && services.length === 0) throw new NotFoundException('deployment not found');

    return {
      project,
      deployment,
      replicas: placements.map((p) => replicaStatus(p)),
      services: services.map((s) => ({
        name: s.id.split('/')[2] ?? s.id,
        addressV4: s.addressV4,
        addressV6: s.addressV6,
      })),
    };
  }
}
