import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Environment } from '@forepath/shared/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';
import { Observable } from 'rxjs';

import type {
  CreateFilterRuleDto,
  FilterRuleResponseDto,
  ListFilterRulesParams,
  UpdateFilterRuleDto,
} from '../state/filter-rules/filter-rules.types';

@Injectable({
  providedIn: 'root',
})
export class FilterRulesService {
  private readonly http = inject(HttpClient);
  private readonly environment = inject<Environment>(ENVIRONMENT);

  private get apiUrl(): string {
    return this.environment.controller.restApiUrl;
  }

  list(params?: ListFilterRulesParams): Observable<FilterRuleResponseDto[]> {
    let httpParams = new HttpParams();

    if (params?.limit !== undefined) {
      httpParams = httpParams.set('limit', params.limit.toString());
    }

    if (params?.offset !== undefined) {
      httpParams = httpParams.set('offset', params.offset.toString());
    }

    return this.http.get<FilterRuleResponseDto[]>(`${this.apiUrl}/filter-rules`, { params: httpParams });
  }

  get(id: string): Observable<FilterRuleResponseDto> {
    return this.http.get<FilterRuleResponseDto>(`${this.apiUrl}/filter-rules/${id}`);
  }

  create(dto: CreateFilterRuleDto): Observable<FilterRuleResponseDto> {
    return this.http.post<FilterRuleResponseDto>(`${this.apiUrl}/filter-rules`, dto);
  }

  update(id: string, dto: UpdateFilterRuleDto): Observable<FilterRuleResponseDto> {
    return this.http.put<FilterRuleResponseDto>(`${this.apiUrl}/filter-rules/${id}`, dto);
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/filter-rules/${id}`);
  }
}
