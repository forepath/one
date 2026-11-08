import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Environment } from '@forepath/agenstra/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/agenstra/frontend/util-configuration';
import type { ConnectionTestResult, DeploymentConnectionSummary } from '@forepath/agenstra/shared/util-opencode-config';
import { Observable } from 'rxjs';

import type {
  CreateDeploymentConnectionDto,
  DeploymentConnectionsQuery,
  UpdateDeploymentConnectionDto,
} from '../state/deployment-connections/deployment-connections.types';

/** Instance-wide CI/CD connections (instance admins; agent-controller `/connections/deployments`). */
@Injectable({
  providedIn: 'root',
})
export class DeploymentConnectionsService {
  private readonly http = inject(HttpClient);
  private readonly environment = inject<Environment>(ENVIRONMENT);

  private get baseUrl(): string {
    return `${this.environment.console.urls.restApi}/connections/deployments`;
  }

  list(query: DeploymentConnectionsQuery = {}): Observable<DeploymentConnectionSummary[]> {
    let params = new HttpParams();

    if (query.limit !== undefined) {
      params = params.set('limit', String(query.limit));
    }

    if (query.offset) {
      params = params.set('offset', String(query.offset));
    }

    if (query.search?.trim()) {
      params = params.set('search', query.search.trim());
    }

    if (query.provider) {
      params = params.set('provider', query.provider);
    }

    return this.http.get<DeploymentConnectionSummary[]>(this.baseUrl, { params });
  }

  get(id: string): Observable<DeploymentConnectionSummary> {
    return this.http.get<DeploymentConnectionSummary>(`${this.baseUrl}/${id}`);
  }

  create(dto: CreateDeploymentConnectionDto): Observable<DeploymentConnectionSummary> {
    return this.http.post<DeploymentConnectionSummary>(this.baseUrl, dto);
  }

  update(id: string, dto: UpdateDeploymentConnectionDto): Observable<DeploymentConnectionSummary> {
    return this.http.put<DeploymentConnectionSummary>(`${this.baseUrl}/${id}`, dto);
  }

  /** 409 while deployment workflows still use the connection. */
  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${id}`);
  }

  /** Persists the result (`lastTestStatus` / `lastTestMessage` / `lastTestedAt`) on the connection. */
  test(id: string): Observable<ConnectionTestResult> {
    return this.http.post<ConnectionTestResult>(`${this.baseUrl}/${id}/test`, {});
  }
}
