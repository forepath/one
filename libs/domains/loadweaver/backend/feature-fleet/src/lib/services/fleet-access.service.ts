import { getUserFromRequest, UserRole, type RequestWithUser } from '@forepath/identity/backend';
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { FleetClusterEntity } from '../entities/fleet-cluster.entity';
import { FleetGrantEntity } from '../entities/fleet-grant.entity';
import { sanitizeHeaderValue } from '../utils/relay-headers';
import {
  clusterAccess,
  hasAnyAccess,
  NO_ACCESS,
  type FleetCaller,
  type FleetClusterAccess,
} from '../utils/fleet-access.utils';

/** Caller of a request: global admins and the static API key administer the fleet; everyone else needs grants. */
export function fleetCallerFromRequest(req: RequestWithUser | undefined): FleetCaller {
  const info = getUserFromRequest(req ?? ({} as RequestWithUser));

  if (info.isApiKeyAuth) return { userId: null, isApiKey: true, isAdmin: true, label: 'fleet:api-key' };

  const who = req?.user?.email || req?.user?.username || info.userId || 'anonymous';

  return {
    userId: info.userId ?? null,
    isApiKey: false,
    isAdmin: info.userRole === UserRole.ADMIN,
    label: sanitizeHeaderValue(`fleet:${who}`),
  };
}

/** Per-cluster (and per-project) access of fleet users (3.24 / 3.17). */
@Injectable()
export class FleetAccessService {
  constructor(
    @InjectRepository(FleetClusterEntity) private readonly clusters: Repository<FleetClusterEntity>,
    @InjectRepository(FleetGrantEntity) private readonly grants: Repository<FleetGrantEntity>,
  ) {}

  caller(req: RequestWithUser | undefined): FleetCaller {
    return fleetCallerFromRequest(req);
  }

  assertAdmin(caller: FleetCaller): void {
    if (!caller.isAdmin) throw new ForbiddenException('fleet admins only');
  }

  async accessFor(caller: FleetCaller, cluster: FleetClusterEntity, now = new Date()): Promise<FleetClusterAccess> {
    if (caller.isAdmin) return clusterAccess(caller, [], cluster, now);

    if (!caller.userId) return NO_ACCESS;

    const grants = await this.grants.find({ where: { clusterId: cluster.id, userId: caller.userId } });

    return clusterAccess(caller, grants, cluster, now);
  }

  /** A cluster the caller may see at all (404 otherwise, so ids of other clusters don't leak). */
  async visibleCluster(
    caller: FleetCaller,
    id: string,
  ): Promise<{ cluster: FleetClusterEntity; access: FleetClusterAccess }> {
    const cluster = await this.clusters.findOne({ where: { id } });

    if (!cluster) throw new NotFoundException('cluster not found');

    const access = await this.accessFor(caller, cluster);

    if (!caller.isAdmin && !hasAnyAccess(access)) throw new NotFoundException('cluster not found');

    return { cluster, access };
  }

  /** Every cluster the caller can see, with the access on each. */
  async visibleClusters(
    caller: FleetCaller,
    ids?: readonly string[],
  ): Promise<{ cluster: FleetClusterEntity; access: FleetClusterAccess }[]> {
    const now = new Date();

    if (caller.isAdmin) {
      const all = await this.clusters.find({ where: ids ? { id: In([...ids]) } : {}, order: { name: 'ASC' } });

      return all.map((cluster) => ({ cluster, access: clusterAccess(caller, [], cluster, now) }));
    }

    if (!caller.userId) return [];

    const grants = await this.grants.find({ where: { userId: caller.userId } });
    const clusterIds = [...new Set(grants.map((g) => g.clusterId))].filter((id) => !ids || ids.includes(id));

    if (!clusterIds.length) return [];

    const rows = await this.clusters.find({ where: { id: In(clusterIds) }, order: { name: 'ASC' } });

    return rows
      .map((cluster) => ({
        cluster,
        access: clusterAccess(
          caller,
          grants.filter((g) => g.clusterId === cluster.id),
          cluster,
          now,
        ),
      }))
      .filter((e) => hasAnyAccess(e.access));
  }
}
