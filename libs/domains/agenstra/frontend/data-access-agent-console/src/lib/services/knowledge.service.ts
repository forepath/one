import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Environment } from '@forepath/shared/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';
import { Observable } from 'rxjs';

import type {
  CreateKnowledgeRelationDto,
  KnowledgePageActivityDto,
  CreateKnowledgeNodeDto,
  KnowledgeRelationDto,
  KnowledgeNodeDto,
  KnowledgeRelationSourceType,
  UpdateKnowledgeNodeDto,
} from '../state/knowledge/knowledge.types';

@Injectable({
  providedIn: 'root',
})
export class KnowledgeService {
  private readonly http = inject(HttpClient);
  private readonly environment = inject<Environment>(ENVIRONMENT);

  private get apiUrl(): string {
    return this.environment.controller.restApiUrl;
  }

  listByClient(clientId: string): Observable<KnowledgeNodeDto[]> {
    const params = new HttpParams().set('clientId', clientId);

    return this.http.get<KnowledgeNodeDto[]>(`${this.apiUrl}/knowledge`, { params });
  }

  getTree(clientId: string): Observable<KnowledgeNodeDto[]> {
    const params = new HttpParams().set('clientId', clientId);

    return this.http.get<KnowledgeNodeDto[]>(`${this.apiUrl}/knowledge/tree`, { params });
  }

  create(dto: CreateKnowledgeNodeDto): Observable<KnowledgeNodeDto> {
    return this.http.post<KnowledgeNodeDto>(`${this.apiUrl}/knowledge`, dto);
  }

  update(id: string, dto: UpdateKnowledgeNodeDto): Observable<KnowledgeNodeDto> {
    return this.http.patch<KnowledgeNodeDto>(`${this.apiUrl}/knowledge/${id}`, dto);
  }

  duplicate(id: string): Observable<KnowledgeNodeDto> {
    return this.http.post<KnowledgeNodeDto>(`${this.apiUrl}/knowledge/${id}/duplicate`, {});
  }

  delete(id: string, releaseExternalSyncMarker?: boolean): Observable<void> {
    let params = new HttpParams();

    if (releaseExternalSyncMarker === true) {
      params = params.set('releaseExternalSyncMarker', 'true');
    }

    return this.http.delete<void>(`${this.apiUrl}/knowledge/${id}`, { params });
  }

  listRelations(
    clientId: string,
    sourceType: KnowledgeRelationSourceType,
    sourceId: string,
  ): Observable<KnowledgeRelationDto[]> {
    const params = new HttpParams().set('clientId', clientId).set('sourceType', sourceType).set('sourceId', sourceId);

    return this.http.get<KnowledgeRelationDto[]>(`${this.apiUrl}/knowledge/relations`, { params });
  }

  createRelation(dto: CreateKnowledgeRelationDto): Observable<KnowledgeRelationDto> {
    return this.http.post<KnowledgeRelationDto>(`${this.apiUrl}/knowledge/relations`, dto);
  }

  deleteRelation(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/knowledge/relations/${id}`);
  }

  listActivity(pageId: string, limit = 50, offset = 0): Observable<KnowledgePageActivityDto[]> {
    const params = new HttpParams().set('limit', String(limit)).set('offset', String(offset));

    return this.http.get<KnowledgePageActivityDto[]>(`${this.apiUrl}/knowledge/${pageId}/activity`, {
      params,
    });
  }
}
