import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Environment } from '@forepath/decabill/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/decabill/frontend/util-configuration';
import { Observable } from 'rxjs';

import type {
  ContainerManagerContainersResponse,
  ContainerManagerLogsResponse,
  ContainerManagerNetworksResponse,
  ContainerManagerStatsHistoryResponse,
} from '../types/billing.types';

@Injectable({
  providedIn: 'root',
})
export class ContainerManagerService {
  private readonly http = inject(HttpClient);
  private readonly environment = inject<Environment>(ENVIRONMENT);

  private get apiUrl(): string {
    return this.environment.billing.urls.restApi;
  }

  private basePath(subscriptionId: string, itemId: string, adminMode: boolean): string {
    if (adminMode) {
      return `${this.apiUrl}/admin/billing/subscriptions/${subscriptionId}/items/${itemId}/container-manager`;
    }

    return `${this.apiUrl}/subscriptions/${subscriptionId}/items/${itemId}/container-manager`;
  }

  listContainers(
    subscriptionId: string,
    itemId: string,
    adminMode = false,
  ): Observable<ContainerManagerContainersResponse> {
    return this.http.get<ContainerManagerContainersResponse>(
      `${this.basePath(subscriptionId, itemId, adminMode)}/containers`,
    );
  }

  getStatsHistory(
    subscriptionId: string,
    itemId: string,
    containerId: string,
    adminMode = false,
  ): Observable<ContainerManagerStatsHistoryResponse> {
    return this.http.get<ContainerManagerStatsHistoryResponse>(
      `${this.basePath(subscriptionId, itemId, adminMode)}/containers/${encodeURIComponent(containerId)}/stats-history`,
    );
  }

  getLogs(
    subscriptionId: string,
    itemId: string,
    containerId: string,
    adminMode = false,
    tail?: number,
  ): Observable<ContainerManagerLogsResponse> {
    let params = new HttpParams();

    if (tail != null) {
      params = params.set('tail', String(tail));
    }

    return this.http.get<ContainerManagerLogsResponse>(
      `${this.basePath(subscriptionId, itemId, adminMode)}/containers/${encodeURIComponent(containerId)}/logs`,
      { params },
    );
  }

  listNetworks(
    subscriptionId: string,
    itemId: string,
    adminMode = false,
  ): Observable<ContainerManagerNetworksResponse> {
    return this.http.get<ContainerManagerNetworksResponse>(
      `${this.basePath(subscriptionId, itemId, adminMode)}/networks`,
    );
  }
}
