import { DOCUMENT } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { tap, type Observable } from 'rxjs';

import type {
  ClusterSummary,
  ConsoleNode,
  CreatedJoinToken,
  CreateJoinTokenRequest,
  JoinToken,
  NodeAction,
  NodePlatformComponent,
  SiemDeliveryStatus,
} from '../types/nodes.types';
import { ConsoleApi } from './console-api';

/** Nodes & sites (3.2, 3.21): inventory, lifecycle actions (runtime, not plan / apply) and join tokens. */
@Injectable({ providedIn: 'root' })
export class NodesService extends ConsoleApi {
  private readonly http = inject(HttpClient);
  private readonly document = inject(DOCUMENT);

  list(): Observable<ConsoleNode[]> {
    return this.http.get<ConsoleNode[]>(this.url('/nodes'));
  }

  get(name: string): Observable<ConsoleNode> {
    return this.http.get<ConsoleNode>(this.url(`/nodes/${encodeURIComponent(name)}`));
  }

  /** Platform components the node runs (etcd, Postgres, registry, ingress …), read-only (2026-10-30). */
  platform(name: string): Observable<NodePlatformComponent[]> {
    return this.http.get<NodePlatformComponent[]>(this.url(`/nodes/${encodeURIComponent(name)}/platform`));
  }

  /** `cordon`, `uncordon`, `drain`, `leave` (drained nodes only) or `confirm-lost` (cluster admins). */
  act(name: string, action: NodeAction): Observable<ConsoleNode> {
    return this.http.post<ConsoleNode>(this.url(`/nodes/${encodeURIComponent(name)}/${action}`), {});
  }

  /** The cluster summary; in fleet mode it also records the cluster's own public / console URLs (installer, links). */
  cluster(): Observable<ClusterSummary> {
    const clusterId = this.endpoints.activeClusterId();

    return this.http.get<ClusterSummary>(this.url('/cluster')).pipe(
      tap((summary) => {
        if (clusterId) this.endpoints.setClusterPublicUrls(clusterId, summary.publicUrl, summary.consoleUrl);
      }),
    );
  }

  /** Delivery state per SIEM target (`GET /cluster/siem`, audit readers). */
  siem(): Observable<SiemDeliveryStatus[]> {
    return this.http.get<SiemDeliveryStatus[]>(this.url('/cluster/siem'));
  }

  joinTokens(): Observable<JoinToken[]> {
    return this.http.get<JoinToken[]>(this.url('/join-tokens'));
  }

  createJoinToken(request: CreateJoinTokenRequest): Observable<CreatedJoinToken> {
    return this.http.post<CreatedJoinToken>(this.url('/join-tokens'), request);
  }

  revokeJoinToken(id: string): Observable<void> {
    return this.http.delete<void>(this.url(`/join-tokens/${encodeURIComponent(id)}`));
  }

  /**
   * Where the one-line installer is served (`GET /install/install.sh`), as an absolute URL: the API URL may be relative
   * (the production default `/api`), but the line runs on another server. Fleet mode: the installer is never relayed,
   * so the line points at the active cluster's own endpoint (`null` while it is unknown).
   */
  installScriptUrl(): string | null {
    if (this.endpoints.fleetMode) {
      // The cluster's own public URL, as its installer embeds it (the new server talks to the cluster directly).
      const native = this.endpoints.activeClusterPublicApi();

      return native ? `${native}/api/install/install.sh` : null;
    }

    const url = this.url('/install/install.sh');

    try {
      return new URL(url, this.document.baseURI).href;
    } catch {
      return url;
    }
  }
}
