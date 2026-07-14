import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { NOTIFICATION_ADMIN_ENVIRONMENT } from '../tokens/notification-admin-environment';
import type {
  CreateWebhookEndpointDto,
  ListWebhookDeliveriesParams,
  ListWebhookEndpointsParams,
  PaginatedWebhookDeliveriesResponseDto,
  UpdateWebhookEndpointDto,
  WebhookDeliveryResponseDto,
  WebhookEndpointResponseDto,
  WebhookEventTypeResponseDto,
} from '../types/webhook-endpoint.types';

@Injectable({
  providedIn: 'root',
})
export class WebhookEndpointsService {
  private readonly http = inject(HttpClient);
  private readonly environment = inject(NOTIFICATION_ADMIN_ENVIRONMENT);

  private get baseUrl(): string {
    return `${this.environment.apiUrl}/${this.environment.webhooksBasePath}`;
  }

  list(params?: ListWebhookEndpointsParams): Observable<WebhookEndpointResponseDto[]> {
    let httpParams = new HttpParams();

    if (params?.limit !== undefined) {
      httpParams = httpParams.set('limit', params.limit.toString());
    }

    if (params?.offset !== undefined) {
      httpParams = httpParams.set('offset', params.offset.toString());
    }

    return this.http.get<WebhookEndpointResponseDto[]>(this.baseUrl, { params: httpParams });
  }

  get(id: string): Observable<WebhookEndpointResponseDto> {
    return this.http.get<WebhookEndpointResponseDto>(`${this.baseUrl}/${id}`);
  }

  create(dto: CreateWebhookEndpointDto): Observable<WebhookEndpointResponseDto> {
    return this.http.post<WebhookEndpointResponseDto>(this.baseUrl, dto);
  }

  update(id: string, dto: UpdateWebhookEndpointDto): Observable<WebhookEndpointResponseDto> {
    return this.http.put<WebhookEndpointResponseDto>(`${this.baseUrl}/${id}`, dto);
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${id}`);
  }

  test(id: string): Observable<WebhookDeliveryResponseDto> {
    return this.http.post<WebhookDeliveryResponseDto>(`${this.baseUrl}/${id}/test`, {});
  }

  listEventTypes(): Observable<WebhookEventTypeResponseDto[]> {
    return this.http.get<WebhookEventTypeResponseDto[]>(`${this.baseUrl}/event-types`);
  }

  listDeliveries(id: string, params?: ListWebhookDeliveriesParams): Observable<PaginatedWebhookDeliveriesResponseDto> {
    let httpParams = new HttpParams();

    if (params?.limit !== undefined) {
      httpParams = httpParams.set('limit', params.limit.toString());
    }

    if (params?.offset !== undefined) {
      httpParams = httpParams.set('offset', params.offset.toString());
    }

    return this.http.get<PaginatedWebhookDeliveriesResponseDto>(`${this.baseUrl}/${id}/deliveries`, {
      params: httpParams,
    });
  }
}
