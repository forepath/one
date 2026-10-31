import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, of, tap, type Observable } from 'rxjs';

import type { AccessMe, ClusterRole, ProjectRole } from '../types/console.types';
import type {
  FleetAvailability,
  FleetCluster,
  FleetClusterAccess,
  FleetClusterIdentity,
  FleetRole,
} from '../types/fleet.types';
import { ConsoleApi } from './console-api';
import { FleetClusterAvailabilityService, fleetAvailabilityOf, fleetWritesPaused } from './fleet-availability.service';

const CLUSTER_ROLE_FOR: Record<FleetRole, ClusterRole> = {
  admin: 'cluster-admin',
  operator: 'infra-operator',
  viewer: 'auditor',
};

const PROJECT_ROLE_FOR: Record<FleetRole, ProjectRole> = {
  admin: 'admin',
  operator: 'operator',
  viewer: 'viewer',
};

/**
 * The caller's access to a cluster **through the fleet** in the console's terms, so the sidebar, guards and actions
 * follow the fleet grant rather than the cluster's service user (which `GET /access/me` through the relay would
 * describe): fleet admin → cluster admin, operator → infra operator, viewer → auditor; project grants keep their
 * role. During the read-only grace — and while the cluster is unreachable or read-only (3.43, 2026-10-31) —
 * everything is capped at auditor / viewer, so the views disable their changes.
 */
export function accessFromFleetGrant(
  access: FleetClusterAccess | null | undefined,
  identity?: FleetClusterIdentity | null,
  availability?: FleetAvailability | null,
): AccessMe {
  const readOnly = !!access?.readOnly || fleetWritesPaused(availability);
  const clusterRole = access?.clusterRole ? (readOnly ? 'auditor' : CLUSTER_ROLE_FOR[access.clusterRole]) : null;
  const projects: Record<string, ProjectRole> = {};

  for (const [project, role] of Object.entries(access?.projects ?? {}))
    projects[project] = readOnly ? 'viewer' : PROJECT_ROLE_FOR[role];

  // Approvals through the fleet (3.24): the cluster verifies the fleet's claims, the caller acts as their person
  // there (creators / approvers are compared with it); never during the read-only grace.
  const fleetIdentity = identity?.status === 'verified' && !!identity.person;
  const fleetApprovals = fleetIdentity && !readOnly;

  // Cluster-wide operator / viewer grants act as project operator / viewer everywhere (like the cluster caps them).
  const allProjects: ProjectRole | undefined =
    access?.clusterRole && access.clusterRole !== 'admin'
      ? readOnly
        ? 'viewer'
        : PROJECT_ROLE_FOR[access.clusterRole]
      : undefined;

  return {
    userId: fleetApprovals ? (identity?.person ?? null) : null,
    clusterRole,
    projects,
    fleetApprovals,
    fleetIdentity,
    ...(allProjects ? { allProjects } : {}),
  };
}

@Injectable({ providedIn: 'root' })
export class AccessService extends ConsoleApi {
  private readonly http = inject(HttpClient);
  private readonly availability = inject(FleetClusterAvailabilityService);

  /**
   * Single-cluster mode: `GET /access/me`. Fleet mode: the fleet grant on the active cluster
   * (`GET <fleet>/clusters/<id>`, see {@link accessFromFleetGrant}); no roles while no cluster is selected.
   */
  me(): Observable<AccessMe> {
    if (!this.endpoints.fleetMode) return this.http.get<AccessMe>(this.url('/access/me'));

    const clusterId = this.endpoints.activeClusterId();

    if (!clusterId) return of({ userId: null, clusterRole: null, projects: {} });

    return this.http.get<FleetCluster>(`${this.endpoints.fleetApi()}/clusters/${encodeURIComponent(clusterId)}`).pipe(
      // The cluster's own endpoint for what stays native (installer, recovery kit, approvals).
      tap((cluster) => {
        this.endpoints.setClusterEndpoint(clusterId, cluster.endpoint);
        // Unreachable / read-only (3.43): the banner, the write guard and the capped access below.
        this.availability.record(clusterId, cluster);
      }),
      // The verified person (3.24) switches on what needs the signed identity: approvals, personal data, secrets.
      map((cluster) => accessFromFleetGrant(cluster.access, cluster.identity, fleetAvailabilityOf(cluster))),
    );
  }
}
