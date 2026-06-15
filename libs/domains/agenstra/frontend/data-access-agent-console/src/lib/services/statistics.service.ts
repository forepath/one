import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Environment } from '@forepath/shared/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';
import { Observable } from 'rxjs';

import type {
  StatisticsAggregateParams,
  StatisticsChatIoListDto,
  StatisticsClientScopeParams,
  StatisticsEntityEventListDto,
  StatisticsFilterDropListDto,
  StatisticsFilterFlagListDto,
  StatisticsSummaryDto,
} from '../state/statistics/statistics.types';

@Injectable({
  providedIn: 'root',
})
export class StatisticsService {
  private readonly http = inject(HttpClient);
  private readonly environment = inject<Environment>(ENVIRONMENT);

  private get apiUrl(): string {
    return this.environment.controller.restApiUrl;
  }

  private buildParams(params?: Record<string, string | number | undefined>): HttpParams {
    let httpParams = new HttpParams();

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          httpParams = httpParams.set(key, String(value));
        }
      });
    }

    return httpParams;
  }

  /** Client-scoped: get summary for a client */
  getClientSummary(
    clientId: string,
    params?: { from?: string; to?: string; groupBy?: 'day' | 'hour' },
  ): Observable<StatisticsSummaryDto> {
    const httpParams = this.buildParams(params);

    return this.http.get<StatisticsSummaryDto>(`${this.apiUrl}/clients/${clientId}/statistics/summary`, {
      params: httpParams,
    });
  }

  /** Client-scoped: get chat I/O for a client */
  getClientChatIo(clientId: string, params?: StatisticsClientScopeParams): Observable<StatisticsChatIoListDto> {
    const httpParams = this.buildParams({
      agentId: params?.agentId,
      from: params?.from,
      to: params?.to,
      direction: params?.direction,
      search: params?.search,
      limit: params?.limit ?? 10,
      offset: params?.offset ?? 0,
    });

    return this.http.get<StatisticsChatIoListDto>(`${this.apiUrl}/clients/${clientId}/statistics/chat-io`, {
      params: httpParams,
    });
  }

  /** Client-scoped: get filter drops for a client */
  getClientFilterDrops(
    clientId: string,
    params?: StatisticsClientScopeParams,
  ): Observable<StatisticsFilterDropListDto> {
    const httpParams = this.buildParams({
      agentId: params?.agentId,
      filterType: params?.filterType,
      from: params?.from,
      to: params?.to,
      search: params?.search,
      limit: params?.limit ?? 10,
      offset: params?.offset ?? 0,
    });

    return this.http.get<StatisticsFilterDropListDto>(`${this.apiUrl}/clients/${clientId}/statistics/filter-drops`, {
      params: httpParams,
    });
  }

  /** Client-scoped: get filter flags for a client */
  getClientFilterFlags(
    clientId: string,
    params?: StatisticsClientScopeParams,
  ): Observable<StatisticsFilterFlagListDto> {
    const httpParams = this.buildParams({
      agentId: params?.agentId,
      filterType: params?.filterType,
      from: params?.from,
      to: params?.to,
      search: params?.search,
      limit: params?.limit ?? 10,
      offset: params?.offset ?? 0,
    });

    return this.http.get<StatisticsFilterFlagListDto>(`${this.apiUrl}/clients/${clientId}/statistics/filter-flags`, {
      params: httpParams,
    });
  }

  /** Client-scoped: get entity events for a client */
  getClientEntityEvents(
    clientId: string,
    params?: StatisticsClientScopeParams,
  ): Observable<StatisticsEntityEventListDto> {
    const httpParams = this.buildParams({
      entityType: params?.entityType,
      eventType: params?.eventType,
      from: params?.from,
      to: params?.to,
      search: params?.search,
      limit: params?.limit ?? 10,
      offset: params?.offset ?? 0,
    });

    return this.http.get<StatisticsEntityEventListDto>(`${this.apiUrl}/clients/${clientId}/statistics/entity-events`, {
      params: httpParams,
    });
  }

  /** Aggregate: get summary (all accessible clients or filter by clientId) */
  getSummary(params?: StatisticsAggregateParams): Observable<StatisticsSummaryDto> {
    const httpParams = this.buildParams({
      clientId: params?.clientId,
      from: params?.from,
      to: params?.to,
      groupBy: params?.groupBy,
    });

    return this.http.get<StatisticsSummaryDto>(`${this.apiUrl}/statistics/summary`, {
      params: httpParams,
    });
  }

  /** Aggregate: get chat I/O */
  getChatIo(params?: StatisticsAggregateParams): Observable<StatisticsChatIoListDto> {
    const httpParams = this.buildParams({
      clientId: params?.clientId,
      agentId: params?.agentId,
      from: params?.from,
      to: params?.to,
      direction: params?.direction,
      search: params?.search,
      limit: params?.limit ?? 10,
      offset: params?.offset ?? 0,
    });

    return this.http.get<StatisticsChatIoListDto>(`${this.apiUrl}/statistics/chat-io`, {
      params: httpParams,
    });
  }

  /** Aggregate: get filter drops */
  getFilterDrops(params?: StatisticsAggregateParams): Observable<StatisticsFilterDropListDto> {
    const httpParams = this.buildParams({
      clientId: params?.clientId,
      agentId: params?.agentId,
      filterType: params?.filterType,
      from: params?.from,
      to: params?.to,
      search: params?.search,
      limit: params?.limit ?? 10,
      offset: params?.offset ?? 0,
    });

    return this.http.get<StatisticsFilterDropListDto>(`${this.apiUrl}/statistics/filter-drops`, {
      params: httpParams,
    });
  }

  /** Aggregate: get filter flags */
  getFilterFlags(params?: StatisticsAggregateParams): Observable<StatisticsFilterFlagListDto> {
    const httpParams = this.buildParams({
      clientId: params?.clientId,
      agentId: params?.agentId,
      filterType: params?.filterType,
      from: params?.from,
      to: params?.to,
      search: params?.search,
      limit: params?.limit ?? 10,
      offset: params?.offset ?? 0,
    });

    return this.http.get<StatisticsFilterFlagListDto>(`${this.apiUrl}/statistics/filter-flags`, {
      params: httpParams,
    });
  }

  /** Aggregate: get entity events */
  getEntityEvents(params?: StatisticsAggregateParams): Observable<StatisticsEntityEventListDto> {
    const httpParams = this.buildParams({
      clientId: params?.clientId,
      entityType: params?.entityType,
      eventType: params?.eventType,
      from: params?.from,
      to: params?.to,
      search: params?.search,
      limit: params?.limit ?? 10,
      offset: params?.offset ?? 0,
    });

    return this.http.get<StatisticsEntityEventListDto>(`${this.apiUrl}/statistics/entity-events`, {
      params: httpParams,
    });
  }
}
