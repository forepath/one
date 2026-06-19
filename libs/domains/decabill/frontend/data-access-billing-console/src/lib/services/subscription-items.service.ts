import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Environment } from '@forepath/shared/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';
import { Observable } from 'rxjs';

import type { ServerInfoResponse, SubscriptionItemResponse } from '../types/billing.types';

@Injectable({
  providedIn: 'root',
})
export class SubscriptionItemsService {
  private readonly http = inject(HttpClient);
  private readonly environment = inject<Environment>(ENVIRONMENT);

  private get apiUrl(): string {
    return this.environment.billing.restApiUrl;
  }

  listSubscriptionItems(subscriptionId: string): Observable<SubscriptionItemResponse[]> {
    return this.http.get<SubscriptionItemResponse[]>(`${this.apiUrl}/subscriptions/${subscriptionId}/items`);
  }

  getServerInfo(subscriptionId: string, itemId: string): Observable<ServerInfoResponse> {
    return this.http.get<ServerInfoResponse>(
      `${this.apiUrl}/subscriptions/${subscriptionId}/items/${itemId}/server-info`,
    );
  }

  startServer(subscriptionId: string, itemId: string): Observable<{ success: boolean }> {
    return this.http.post<{ success: boolean }>(
      `${this.apiUrl}/subscriptions/${subscriptionId}/items/${itemId}/actions/start`,
      {},
    );
  }

  stopServer(subscriptionId: string, itemId: string): Observable<{ success: boolean }> {
    return this.http.post<{ success: boolean }>(
      `${this.apiUrl}/subscriptions/${subscriptionId}/items/${itemId}/actions/stop`,
      {},
    );
  }

  restartServer(subscriptionId: string, itemId: string): Observable<{ success: boolean }> {
    return this.http.post<{ success: boolean }>(
      `${this.apiUrl}/subscriptions/${subscriptionId}/items/${itemId}/actions/restart`,
      {},
    );
  }
}
