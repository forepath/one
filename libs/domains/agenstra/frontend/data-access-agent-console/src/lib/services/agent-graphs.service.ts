import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Environment } from '@forepath/agenstra/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/agenstra/frontend/util-configuration';
import { Observable } from 'rxjs';

import type {
  AgentGraphDocument,
  AgentGraphFileResponse,
  AgentGraphQueryLayer,
  AgentGraphNodeDetail,
  AgentGraphNodeType,
  AgentGraphOverview,
  AgentGraphPathResponse,
  AgentGraphReferencesResponse,
  AgentGraphRefreshResponse,
  AgentGraphSearchResponse,
  AgentGraphStatus,
  AgentGraphViewLayer,
  AgentGraphWorkspaceSnapshotStatus,
} from '../state/agent-graphs/agent-graphs.types';

export interface AgentGraphDocumentQuery {
  layer?: AgentGraphQueryLayer;
  limit?: number;
  offset?: number;
  types?: readonly AgentGraphNodeType[];
}

export interface AgentGraphViewQuery {
  layer?: AgentGraphViewLayer;
  limit?: number;
  offset?: number;
}

export interface AgentGraphSearchQuery {
  query: string;
  layer?: AgentGraphQueryLayer;
  types?: readonly AgentGraphNodeType[];
  limit?: number;
}

export interface AgentGraphNeighborsQuery {
  layer?: AgentGraphQueryLayer;
  depth?: number;
  limit?: number;
}

/**
 * Environment graphs (agent-controller REST). Node ids contain `/`, `#` and `:`, so they always travel as query
 * parameters.
 */
@Injectable({
  providedIn: 'root',
})
export class AgentGraphsService {
  private readonly http = inject(HttpClient);
  private readonly environment = inject<Environment>(ENVIRONMENT);

  private get apiUrl(): string {
    return this.environment.console.urls.restApi;
  }

  getStatus(clientId: string, agentId: string): Observable<AgentGraphStatus> {
    return this.http.get<AgentGraphStatus>(`${this.graphUrl(clientId, agentId)}/status`);
  }

  getOverview(clientId: string, agentId: string): Observable<AgentGraphOverview> {
    return this.http.get<AgentGraphOverview>(`${this.graphUrl(clientId, agentId)}/overview`);
  }

  getDocument(clientId: string, agentId: string, query: AgentGraphDocumentQuery = {}): Observable<AgentGraphDocument> {
    let params = new HttpParams();

    params = setParam(params, 'layer', query.layer);
    params = setParam(params, 'limit', query.limit);
    params = setParam(params, 'types', query.types?.length ? query.types.join(',') : undefined);
    params = setParam(params, 'offset', query.offset);

    return this.http.get<AgentGraphDocument>(this.graphUrl(clientId, agentId), { params });
  }

  search(clientId: string, agentId: string, query: AgentGraphSearchQuery): Observable<AgentGraphSearchResponse> {
    let params = new HttpParams().set('query', query.query);

    params = setParam(params, 'layer', query.layer);
    params = setParam(params, 'types', query.types?.length ? query.types.join(',') : undefined);
    params = setParam(params, 'limit', query.limit);

    return this.http.get<AgentGraphSearchResponse>(`${this.graphUrl(clientId, agentId)}/search`, { params });
  }

  getNode(
    clientId: string,
    agentId: string,
    nodeId: string,
    layer?: AgentGraphQueryLayer,
  ): Observable<AgentGraphNodeDetail> {
    const params = setParam(new HttpParams().set('id', nodeId), 'layer', layer);

    return this.http.get<AgentGraphNodeDetail>(`${this.graphUrl(clientId, agentId)}/nodes`, { params });
  }

  getNeighbors(
    clientId: string,
    agentId: string,
    nodeId: string,
    query: AgentGraphNeighborsQuery = {},
  ): Observable<AgentGraphDocument> {
    let params = new HttpParams().set('id', nodeId);

    params = setParam(params, 'layer', query.layer);
    params = setParam(params, 'depth', query.depth);
    params = setParam(params, 'limit', query.limit);

    return this.http.get<AgentGraphDocument>(`${this.graphUrl(clientId, agentId)}/neighbors`, { params });
  }

  getPath(
    clientId: string,
    agentId: string,
    from: string,
    to: string,
    layer?: AgentGraphQueryLayer,
  ): Observable<AgentGraphPathResponse> {
    const params = setParam(new HttpParams().set('from', from).set('to', to), 'layer', layer);

    return this.http.get<AgentGraphPathResponse>(`${this.graphUrl(clientId, agentId)}/path`, { params });
  }

  getFile(clientId: string, agentId: string, path: string): Observable<AgentGraphFileResponse> {
    return this.http.get<AgentGraphFileResponse>(`${this.graphUrl(clientId, agentId)}/file`, {
      params: new HttpParams().set('path', path),
    });
  }

  getReferences(
    clientId: string,
    agentId: string,
    query: { promptId?: string; limit?: number } = {},
  ): Observable<AgentGraphReferencesResponse> {
    let params = new HttpParams();

    params = setParam(params, 'promptId', query.promptId);
    params = setParam(params, 'limit', query.limit);

    return this.http.get<AgentGraphReferencesResponse>(`${this.graphUrl(clientId, agentId)}/references`, { params });
  }

  /** Queues a rebuild (202). */
  refresh(clientId: string, agentId: string): Observable<AgentGraphRefreshResponse> {
    return this.http.post<AgentGraphRefreshResponse>(`${this.graphUrl(clientId, agentId)}/refresh`, {});
  }

  /**
   * Workspace graph per layer (`all`, `code`, `paths`, `references`, `knowledge`), one page (`offset` / `limit`). The
   * controller resolves the member environments itself.
   */
  getWorkspaceGraph(clientId: string, query: AgentGraphViewQuery = {}): Observable<AgentGraphDocument> {
    return this.http.get<AgentGraphDocument>(`${this.apiUrl}/clients/${encodeURIComponent(clientId)}/graph`, {
      params: viewParams(query),
    });
  }

  /** Rebuilds the workspace's metadata snapshot (knowledge layer). */
  refreshWorkspaceSnapshot(clientId: string): Observable<AgentGraphWorkspaceSnapshotStatus> {
    return this.http.post<AgentGraphWorkspaceSnapshotStatus>(
      `${this.apiUrl}/clients/${encodeURIComponent(clientId)}/graph/snapshot/refresh`,
      {},
    );
  }

  /** Graph over every workspace the caller can access, per layer, one page. */
  getGlobalGraph(query: AgentGraphViewQuery = {}): Observable<AgentGraphDocument> {
    return this.http.get<AgentGraphDocument>(`${this.apiUrl}/graph/global`, { params: viewParams(query) });
  }

  getGlobalStatus(): Observable<AgentGraphWorkspaceSnapshotStatus[]> {
    return this.http.get<AgentGraphWorkspaceSnapshotStatus[]>(`${this.apiUrl}/graph/global/status`);
  }

  private graphUrl(clientId: string, agentId: string): string {
    return `${this.apiUrl}/clients/${encodeURIComponent(clientId)}/agents/${encodeURIComponent(agentId)}/graph`;
  }
}

function setParam(params: HttpParams, key: string, value: string | number | undefined | null): HttpParams {
  return value === undefined || value === null || value === '' ? params : params.set(key, String(value));
}

function viewParams(query: AgentGraphViewQuery): HttpParams {
  let params = new HttpParams();

  params = setParam(params, 'layer', query.layer);
  params = setParam(params, 'limit', query.limit);
  params = setParam(params, 'offset', query.offset);

  return params;
}
