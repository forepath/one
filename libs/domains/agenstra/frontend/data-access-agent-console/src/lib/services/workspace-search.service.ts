import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Environment } from '@forepath/shared/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';
import { Observable } from 'rxjs';

import type {
  WorkspaceIndexStatusDto,
  WorkspaceSearchMode,
  WorkspaceSearchResponseDto,
} from '../state/workspace-search/workspace-search.types';

@Injectable({ providedIn: 'root' })
export class WorkspaceSearchService {
  private readonly http = inject(HttpClient);
  private readonly environment = inject<Environment>(ENVIRONMENT);

  private get apiUrl(): string {
    return this.environment.controller.restApiUrl;
  }

  getStatus(clientId: string, agentId: string): Observable<WorkspaceIndexStatusDto> {
    return this.http.get<WorkspaceIndexStatusDto>(
      `${this.apiUrl}/clients/${clientId}/agents/${agentId}/workspace-search/status`,
    );
  }

  search(
    clientId: string,
    agentId: string,
    query: string,
    includePaths: string[],
    excludePaths: string[],
    mode: WorkspaceSearchMode = 'full',
  ): Observable<WorkspaceSearchResponseDto> {
    let params = new HttpParams().set('q', query).set('mode', mode);

    for (const path of includePaths) {
      params = params.append('include', path);
    }

    for (const path of excludePaths) {
      params = params.append('exclude', path);
    }

    return this.http.get<WorkspaceSearchResponseDto>(
      `${this.apiUrl}/clients/${clientId}/agents/${agentId}/workspace-search`,
      { params },
    );
  }

  reindex(clientId: string, agentId: string): Observable<{ accepted: true }> {
    return this.http.post<{ accepted: true }>(
      `${this.apiUrl}/clients/${clientId}/agents/${agentId}/workspace-search/reindex`,
      {},
    );
  }
}
