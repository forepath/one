import { BadRequestException, Injectable } from '@nestjs/common';

import { fleetCacheTtlMs } from '../constants/fleet.constants';
import type { FleetClusterEntity } from '../entities/fleet-cluster.entity';
import {
  buildFleetCard,
  compareClusters,
  DRIFT_KINDS,
  fleetSites,
  mergeInbox,
  type ClusterOverviewLike,
  type ClusterResourceLike,
  type ClusterSnapshot,
  type ClusterUpdatesLike,
  type FleetCard,
  type FleetComparison,
  type FleetInboxItem,
  type FleetSite,
} from '../utils/fleet-aggregation.utils';
import type { FleetCaller, FleetClusterAccess } from '../utils/fleet-access.utils';
import { FleetAccessService } from './fleet-access.service';
import { FleetClusterClient, FleetClusterError } from './fleet-cluster-client.service';

interface CacheEntry<T> {
  at: number;
  value: Promise<T>;
}

/**
 * Fleet views (3.25 "Fleet overview"): cards, merged inbox, sites and comparison, aggregated from each cluster's own
 * endpoints with the service credential and cached per cluster for `FLEET_CACHE_TTL_MS` (in memory, per replica).
 * Only clusters with a cluster-wide grant contribute data; project-only grants get a limited card.
 */
@Injectable()
export class FleetOverviewService {
  private readonly snapshots = new Map<string, CacheEntry<ClusterSnapshot>>();
  private readonly policies = new Map<string, CacheEntry<ClusterResourceLike[] | null>>();

  constructor(
    private readonly access: FleetAccessService,
    private readonly client: FleetClusterClient,
  ) {}

  private cached<T>(cache: Map<string, CacheEntry<T>>, key: string, load: () => Promise<T>): Promise<T> {
    const ttl = fleetCacheTtlMs();
    const hit = cache.get(key);

    if (hit && Date.now() - hit.at < ttl) return hit.value;

    const value = load().catch((error: unknown) => {
      cache.delete(key);
      throw error;
    });

    cache.set(key, { at: Date.now(), value });

    return value;
  }

  /** Drops what the fleet cached for a cluster (after changes through the relay or a new credential). */
  invalidate(clusterId: string): void {
    this.snapshots.delete(clusterId);
    this.policies.delete(clusterId);
  }

  private async part<T>(
    cluster: FleetClusterEntity,
    name: string,
    path: string,
    query: Record<string, unknown>,
    errors: string[],
  ) {
    try {
      return (await this.client.json<T>(cluster, { method: 'GET', path, query })).data;
    } catch (error) {
      errors.push(`${name}: ${error instanceof FleetClusterError && error.status ? error.status : 'unreachable'}`);

      return null;
    }
  }

  snapshot(cluster: FleetClusterEntity): Promise<ClusterSnapshot> {
    return this.cached(this.snapshots, cluster.id, async () => {
      const errors: string[] = [];

      if (cluster.state === 'retired')
        return {
          overview: null,
          updates: null,
          pendingPlans: null,
          sites: null,
          errors: ['retired'],
          fetchedAt: new Date().toISOString(),
        };

      const [overview, updates, plans, sites] = await Promise.all([
        this.part<ClusterOverviewLike>(cluster, 'overview', 'overview', {}, errors),
        this.part<ClusterUpdatesLike>(cluster, 'updates', 'updates/status', {}, errors),
        this.part<unknown[]>(cluster, 'plans', 'plans', { status: 'pending', limit: 200 }, errors),
        this.part<ClusterResourceLike[]>(cluster, 'sites', 'resources', { kind: 'Site' }, errors),
      ]);

      return {
        overview,
        updates,
        pendingPlans: Array.isArray(plans) ? plans.length : null,
        sites: Array.isArray(sites) ? sites : null,
        errors,
        fetchedAt: new Date().toISOString(),
      };
    });
  }

  private policyResources(cluster: FleetClusterEntity): Promise<ClusterResourceLike[] | null> {
    return this.cached(this.policies, cluster.id, async () => {
      const lists = await Promise.all(
        DRIFT_KINDS.map(async (kind) => {
          try {
            return (
              await this.client.json<ClusterResourceLike[]>(cluster, {
                method: 'GET',
                path: 'resources',
                query: { kind },
              })
            ).data;
          } catch {
            return null;
          }
        }),
      );

      return lists.some((l) => l === null) ? null : lists.flatMap((l) => l ?? []);
    });
  }

  private full(access: FleetClusterAccess): boolean {
    return !!access.clusterRole;
  }

  async cards(caller: FleetCaller): Promise<FleetCard[]> {
    const visible = await this.access.visibleClusters(caller);

    return await Promise.all(
      visible.map(async ({ cluster, access }) =>
        buildFleetCard(cluster, this.full(access) ? await this.snapshot(cluster) : null, !this.full(access)),
      ),
    );
  }

  async inbox(caller: FleetCaller): Promise<FleetInboxItem[]> {
    const visible = (await this.access.visibleClusters(caller)).filter((v) => this.full(v.access));
    const entries = await Promise.all(
      visible.map(async ({ cluster }) => ({
        cluster: { id: cluster.id, name: cluster.name, endpoint: cluster.endpoint },
        health: cluster.health,
        inbox: (await this.snapshot(cluster)).overview?.inbox ?? null,
      })),
    );

    return mergeInbox(entries);
  }

  async sites(caller: FleetCaller): Promise<{ sites: FleetSite[]; withoutLocation: number }> {
    const visible = (await this.access.visibleClusters(caller)).filter((v) => this.full(v.access));
    const entries = await Promise.all(
      visible.map(async ({ cluster }) => ({
        cluster: { id: cluster.id, name: cluster.name },
        sites: (await this.snapshot(cluster)).sites,
      })),
    );

    return fleetSites(entries);
  }

  async compare(caller: FleetCaller, ids: string[]): Promise<FleetComparison> {
    const unique = [...new Set(ids)];

    if (unique.length < 2 || unique.length > 8) throw new BadRequestException('compare 2 to 8 clusters');

    const visible = (await this.access.visibleClusters(caller, unique)).filter((v) => this.full(v.access));

    if (visible.length !== unique.length) throw new BadRequestException('every cluster needs a cluster-wide grant');

    const entries = await Promise.all(
      visible.map(async ({ cluster }) => ({
        cluster: { id: cluster.id, name: cluster.name },
        card: buildFleetCard(cluster, await this.snapshot(cluster), false),
        policies: await this.policyResources(cluster),
      })),
    );

    return compareClusters(entries);
  }
}
