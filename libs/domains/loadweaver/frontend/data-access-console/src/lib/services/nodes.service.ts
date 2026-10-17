import { DOCUMENT } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';

import type {
  ClusterSummary,
  ConsoleNode,
  CreatedJoinToken,
  CreateJoinTokenRequest,
  JoinToken,
  NodeAction,
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

  /** `cordon`, `uncordon`, `drain`, `leave` (drained nodes only) or `confirm-lost` (cluster admins). */
  act(name: string, action: NodeAction): Observable<ConsoleNode> {
    return this.http.post<ConsoleNode>(this.url(`/nodes/${encodeURIComponent(name)}/${action}`), {});
  }

  cluster(): Observable<ClusterSummary> {
    return this.http.get<ClusterSummary>(this.url('/cluster'));
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
   * (the production default `/api`), but the line runs on another server.
   */
  installScriptUrl(): string {
    const url = this.url('/install/install.sh');

    try {
      return new URL(url, this.document.baseURI).href;
    } catch {
      return url;
    }
  }
}
