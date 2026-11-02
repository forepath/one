import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import type { CloudTeardownDto, RegisterCloudClusterDto } from '../dto/fleet.dto';
import { FleetClusterEntity } from '../entities/fleet-cluster.entity';
import { FleetOperationEntity } from '../entities/fleet-operation.entity';
import type { FleetCaller } from '../utils/fleet-access.utils';
import { NO_ACCESS } from '../utils/fleet-access.utils';
import { FleetAccessEvents } from './fleet-access-events.service';
import { FleetAuditService } from './fleet-audit.service';
import { FleetClustersService, toClusterDto, type FleetClusterDto } from './fleet-clusters.service';
import { FleetOperationsService, toOperationDto, type FleetOperationDto } from './fleet-operations.service';

/** Longest read-only grace the fleet accepts (Decabill's maximum is 90 days). */
const MAX_GRACE_MS = 120 * 86_400_000;

export interface CloudClusterStatusDto {
  cluster: FleetClusterDto;
  finalBackup: FleetOperationDto | null;
}

/**
 * Loadweaver Cloud hooks (section 4, carried from P3): Decabill-provisioned clusters are registered in the fleet
 * with a service credential (`reference` = `decabill:<subscription>:<item>`); before a teardown Decabill calls the
 * fleet with a dedicated credential, which triggers the cluster's final backup and switches the cluster into its
 * read-only grace: every grant is capped at viewer until `readOnlyUntil` (Loadweaver itself has no read-only mode,
 * so the restriction lives at the fleet), then the connection is retired.
 */
@Injectable()
export class FleetCloudService {
  constructor(
    @InjectRepository(FleetClusterEntity) private readonly clusters: Repository<FleetClusterEntity>,
    @InjectRepository(FleetOperationEntity) private readonly operations: Repository<FleetOperationEntity>,
    private readonly connections: FleetClustersService,
    private readonly ops: FleetOperationsService,
    private readonly audit: FleetAuditService,
    @Optional() private readonly accessEvents?: FleetAccessEvents,
  ) {}

  private async byReference(reference: string): Promise<FleetClusterEntity> {
    const cluster = await this.connections.findByReference(reference);

    if (!cluster) throw new NotFoundException('no cluster registered for this reference');

    return cluster;
  }

  async register(caller: FleetCaller, dto: RegisterCloudClusterDto): Promise<FleetClusterDto> {
    const cluster = await this.connections.create(caller, dto, { reference: dto.reference });

    for (const grant of dto.grants ?? []) await this.connections.putGrant(caller, cluster.id, grant);

    await this.audit.record(
      caller,
      'cloud.registered',
      `cluster/${cluster.id}`,
      { reference: dto.reference },
      cluster.id,
    );

    return toClusterDto(cluster, NO_ACCESS);
  }

  async status(reference: string): Promise<CloudClusterStatusDto> {
    const cluster = await this.byReference(reference);
    const finalBackup = await this.operations.findOne({
      where: { kind: 'final-backup', targetClusterId: cluster.id },
      order: { createdAt: 'DESC' },
    });

    return { cluster: toClusterDto(cluster, NO_ACCESS), finalBackup: finalBackup ? toOperationDto(finalBackup) : null };
  }

  /**
   * Teardown announced (idempotent, Decabill calls it on every run during the grace): read-only until the given
   * time and — once per teardown — the final backup.
   */
  async teardown(
    caller: FleetCaller,
    reference: string,
    dto: CloudTeardownDto,
    now = new Date(),
  ): Promise<CloudClusterStatusDto> {
    const cluster = await this.byReference(reference);
    const until = new Date(dto.readOnlyUntil);

    if (Number.isNaN(until.getTime()) || until.getTime() - now.getTime() > MAX_GRACE_MS)
      throw new BadRequestException('readOnlyUntil must be a time within 120 days');

    if (cluster.state === 'retired') return await this.status(reference);

    const entering = cluster.state !== 'teardown';
    const changed = entering || cluster.readOnlyUntil?.getTime() !== until.getTime();

    if (changed) {
      cluster.state = 'teardown';
      cluster.readOnlyUntil = until;
      cluster.readOnlyReason = (dto.reason ?? 'Loadweaver Cloud subscription cancelled').slice(0, 255);
      await this.clusters.save(cluster);
      await this.audit.record(
        caller,
        entering ? 'cloud.teardown-started' : 'cloud.teardown-updated',
        `cluster/${cluster.id}`,
        { reference, readOnlyUntil: until.toISOString() },
        cluster.id,
      );
      this.accessEvents?.accessChanged(cluster.id);
    }

    // Grace already ended: nothing left to back up through the fleet.
    if (dto.finalBackup !== false && until.getTime() > now.getTime())
      await this.ops.startFinalBackup(caller, cluster, entering ? now : new Date(0));

    return await this.status(reference);
  }

  /** The subscription was resumed before the teardown: full access again. */
  async cancelTeardown(caller: FleetCaller, reference: string): Promise<CloudClusterStatusDto> {
    const cluster = await this.byReference(reference);

    if (cluster.state === 'teardown') {
      cluster.state = 'active';
      cluster.readOnlyUntil = null;
      cluster.readOnlyReason = null;
      await this.clusters.save(cluster);
      await this.audit.record(caller, 'cloud.teardown-cancelled', `cluster/${cluster.id}`, { reference }, cluster.id);
      this.accessEvents?.accessChanged(cluster.id);
    }

    return await this.status(reference);
  }
}
