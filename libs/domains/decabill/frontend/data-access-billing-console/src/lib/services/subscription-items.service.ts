import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Environment } from '@forepath/decabill/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/decabill/frontend/util-configuration';
import { Observable } from 'rxjs';

import type {
  ServerInfoResponse,
  SubscriptionItemDetailResponse,
  SubscriptionItemResponse,
  SubscriptionSshAccessKeyResponse,
} from '../types/billing.types';

@Injectable({
  providedIn: 'root',
})
export class SubscriptionItemsService {
  private readonly http = inject(HttpClient);
  private readonly environment = inject<Environment>(ENVIRONMENT);

  private get apiUrl(): string {
    return this.environment.billing.urls.restApi;
  }

  listSubscriptionItems(subscriptionId: string): Observable<SubscriptionItemResponse[]> {
    return this.http.get<SubscriptionItemResponse[]>(`${this.apiUrl}/subscriptions/${subscriptionId}/items`);
  }

  getItemDetail(subscriptionId: string, itemId: string): Observable<SubscriptionItemDetailResponse> {
    return this.http.get<SubscriptionItemDetailResponse>(
      `${this.apiUrl}/subscriptions/${subscriptionId}/items/${itemId}`,
    );
  }

  updateDisplayName(
    subscriptionId: string,
    itemId: string,
    displayName: string | null,
  ): Observable<SubscriptionItemResponse> {
    return this.http.post<SubscriptionItemResponse>(
      `${this.apiUrl}/subscriptions/${subscriptionId}/items/${itemId}/display-name`,
      { displayName },
    );
  }

  getServerInfo(subscriptionId: string, itemId: string): Observable<ServerInfoResponse> {
    return this.http.get<ServerInfoResponse>(
      `${this.apiUrl}/subscriptions/${subscriptionId}/items/${itemId}/server-info`,
    );
  }

  getSshAccessKey(subscriptionId: string, itemId: string): Observable<SubscriptionSshAccessKeyResponse> {
    return this.http.get<SubscriptionSshAccessKeyResponse>(
      `${this.apiUrl}/subscriptions/${subscriptionId}/items/${itemId}/ssh-access-key`,
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
