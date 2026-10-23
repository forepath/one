import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, of, type Observable } from 'rxjs';

import type { AccessMe, ClusterRole, ProjectRole } from '../types/console.types';
import type { FleetCluster, FleetClusterAccess, FleetRole } from '../types/fleet.types';
import { ConsoleApi } from './console-api';

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
 * role. During the read-only grace everything is capped at auditor / viewer.
 */
export function accessFromFleetGrant(access: FleetClusterAccess | null | undefined): AccessMe {
  const readOnly = !!access?.readOnly;
  const clusterRole = access?.clusterRole ? (readOnly ? 'auditor' : CLUSTER_ROLE_FOR[access.clusterRole]) : null;
  const projects: Record<string, ProjectRole> = {};

  for (const [project, role] of Object.entries(access?.projects ?? {}))
    projects[project] = readOnly ? 'viewer' : PROJECT_ROLE_FOR[role];

  return { userId: null, clusterRole, projects };
}

@Injectable({ providedIn: 'root' })
export class AccessService extends ConsoleApi {
  private readonly http = inject(HttpClient);

  /**
   * Single-cluster mode: `GET /access/me`. Fleet mode: the fleet grant on the active cluster
   * (`GET <fleet>/clusters/<id>`, see {@link accessFromFleetGrant}); no roles while no cluster is selected.
   */
  me(): Observable<AccessMe> {
    if (!this.endpoints.fleetMode) return this.http.get<AccessMe>(this.url('/access/me'));

    const clusterId = this.endpoints.activeClusterId();

    if (!clusterId) return of({ userId: null, clusterRole: null, projects: {} });

    return this.http
      .get<FleetCluster>(`${this.endpoints.fleetApi()}/clusters/${encodeURIComponent(clusterId)}`)
      .pipe(map((cluster) => accessFromFleetGrant(cluster.access)));
  }
}
