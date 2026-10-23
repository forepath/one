import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, type Observable } from 'rxjs';

import type {
  CreateFleetCluster,
  CreateFleetOperation,
  FleetAuditEntry,
  FleetAuditFilter,
  FleetCard,
  FleetCloudStatus,
  FleetCluster,
  FleetClusterHealth,
  FleetComparison,
  FleetGrant,
  FleetInboxItem,
  FleetOperation,
  FleetSites,
  FleetSourceBackup,
  FleetUser,
  PutFleetGrant,
  TestFleetConnection,
  UpdateFleetCluster,
} from '../types/fleet.types';
import { ConsoleEndpointService, fleetRelayApiUrl } from './console-endpoint.service';

/**
 * The fleet service's own API (3.24; fleet mode): cluster connections, grants, the fleet views, cross-cluster
 * operations, Loadweaver Cloud status and the fleet audit log. Cluster views don't use it — they go through the
 * relay of the active cluster (`ConsoleApi`).
 */
@Injectable({ providedIn: 'root' })
export class FleetService {
  private readonly http = inject(HttpClient);
  private readonly endpoints = inject(ConsoleEndpointService);

  private url(path: string): string {
    return `${this.endpoints.fleetApi()}${path}`;
  }

  clusters(): Observable<FleetCluster[]> {
    return this.http.get<FleetCluster[]>(this.url('/clusters'));
  }

  cluster(id: string): Observable<FleetCluster> {
    return this.http.get<FleetCluster>(this.url(`/clusters/${encodeURIComponent(id)}`));
  }

  createCluster(body: CreateFleetCluster): Observable<FleetCluster> {
    return this.http.post<FleetCluster>(this.url('/clusters'), body);
  }

  updateCluster(id: string, body: UpdateFleetCluster): Observable<FleetCluster> {
    return this.http.patch<FleetCluster>(this.url(`/clusters/${encodeURIComponent(id)}`), body);
  }

  deleteCluster(id: string): Observable<void> {
    return this.http.delete<void>(this.url(`/clusters/${encodeURIComponent(id)}`));
  }

  /** Probes an endpoint + credential without saving. */
  testConnection(body: TestFleetConnection): Observable<FleetClusterHealth> {
    return this.http.post<FleetClusterHealth>(this.url('/clusters/test'), body);
  }

  /** Health poll of a registered cluster now. */
  pollCluster(id: string): Observable<FleetClusterHealth> {
    return this.http.post<FleetClusterHealth>(this.url(`/clusters/${encodeURIComponent(id)}/test`), {});
  }

  grants(clusterId: string): Observable<FleetGrant[]> {
    return this.http.get<FleetGrant[]>(this.url(`/clusters/${encodeURIComponent(clusterId)}/grants`));
  }

  putGrant(clusterId: string, body: PutFleetGrant): Observable<FleetGrant> {
    return this.http.put<FleetGrant>(this.url(`/clusters/${encodeURIComponent(clusterId)}/grants`), body);
  }

  deleteGrant(clusterId: string, grantId: string): Observable<void> {
    return this.http.delete<void>(
      this.url(`/clusters/${encodeURIComponent(clusterId)}/grants/${encodeURIComponent(grantId)}`),
    );
  }

  /** Fleet users for grants (the fleet's identity, global admins; `users` authentication). */
  users(search: string, limit = 20): Observable<FleetUser[]> {
    let params = new HttpParams().set('limit', String(limit));

    if (search.trim()) params = params.set('search', search.trim());

    return this.http
      .get<FleetUser[]>(this.url('/users'), { params })
      .pipe(map((users) => users.map((u) => ({ id: u.id, email: u.email }))));
  }

  cards(): Observable<FleetCard[]> {
    return this.http.get<FleetCard[]>(this.url('/fleet/cards'));
  }

  inbox(): Observable<FleetInboxItem[]> {
    return this.http.get<FleetInboxItem[]>(this.url('/fleet/inbox'));
  }

  sites(): Observable<FleetSites> {
    return this.http.get<FleetSites>(this.url('/fleet/sites'));
  }

  /** 2 to 8 clusters. */
  compare(clusterIds: readonly string[]): Observable<FleetComparison> {
    return this.http.get<FleetComparison>(this.url('/fleet/compare'), {
      params: new HttpParams().set('clusters', clusterIds.join(',')),
    });
  }

  operations(query: { cluster?: string; limit?: number } = {}): Observable<FleetOperation[]> {
    let params = new HttpParams();

    if (query.cluster) params = params.set('cluster', query.cluster);

    if (query.limit) params = params.set('limit', String(query.limit));

    return this.http.get<FleetOperation[]>(this.url('/operations'), { params });
  }

  operation(id: string): Observable<FleetOperation> {
    return this.http.get<FleetOperation>(this.url(`/operations/${encodeURIComponent(id)}`));
  }

  createOperation(body: CreateFleetOperation): Observable<FleetOperation> {
    return this.http.post<FleetOperation>(this.url('/operations'), body);
  }

  cancelOperation(id: string): Observable<FleetOperation> {
    return this.http.post<FleetOperation>(this.url(`/operations/${encodeURIComponent(id)}/cancel`), {});
  }

  /** Teardown state and latest final backup of a Loadweaver Cloud cluster (fleet admins). */
  cloudStatus(reference: string): Observable<FleetCloudStatus> {
    return this.http.get<FleetCloudStatus>(this.url(`/cloud/clusters/${encodeURIComponent(reference)}`));
  }

  /** Newest first; `before` is the `seq` of the last entry of the previous page. */
  audit(filter: FleetAuditFilter, limit: number, before?: string | null): Observable<FleetAuditEntry[]> {
    let params = new HttpParams().set('limit', String(limit));

    if (filter.cluster) params = params.set('cluster', filter.cluster);

    if (filter.action) params = params.set('action', filter.action);

    if (before) params = params.set('before', before);

    return this.http.get<FleetAuditEntry[]>(this.url('/audit'), { params });
  }

  /**
   * Succeeded backups of a cluster for the restore wizard, read through the relay (`GET /backups`, `?project=` for
   * project grants) — independent of the active cluster.
   */
  sourceBackups(clusterId: string, project: string | null): Observable<FleetSourceBackup[]> {
    let params = new HttpParams().set('limit', '200');

    if (project) params = params.set('project', project);

    return this.http
      .get<FleetSourceBackup[]>(`${fleetRelayApiUrl(this.endpoints.fleetApi(), clusterId)}/backups`, { params })
      .pipe(map((backups) => backups.filter((b) => b.status === 'succeeded')));
  }
}
