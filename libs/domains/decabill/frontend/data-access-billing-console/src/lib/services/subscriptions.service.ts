import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Environment } from '@forepath/decabill/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/decabill/frontend/util-configuration';
import { Observable } from 'rxjs';

import type {
  CancelSubscriptionDto,
  CreateSubscriptionDto,
  ListParams,
  ResumeSubscriptionDto,
  SubscriptionResponse,
  SubscriptionsSummaryResponse,
  WithdrawSubscriptionDto,
} from '../types/billing.types';
import type {
  ConfigChangeEligibility,
  ConfigChangePreviewResponse,
  ConfigChangeRequest,
  ConfigChangeResponse,
} from '../types/config-change.types';

@Injectable({
  providedIn: 'root',
})
export class SubscriptionsService {
  private readonly http = inject(HttpClient);
  private readonly environment = inject<Environment>(ENVIRONMENT);

  /**
   * Get the base URL for the billing API.
   */
  private get apiUrl(): string {
    return this.environment.billing.urls.restApi;
  }

  /**
   * List all subscriptions for the current user with optional pagination.
   */
  listSubscriptions(params?: ListParams): Observable<SubscriptionResponse[]> {
    let httpParams = new HttpParams();

    if (params?.limit !== undefined) {
      httpParams = httpParams.set('limit', params.limit.toString());
    }

    if (params?.offset !== undefined) {
      httpParams = httpParams.set('offset', params.offset.toString());
    }

    if (params?.search?.trim()) {
      httpParams = httpParams.set('search', params.search.trim());
    }

    return this.http.get<SubscriptionResponse[]>(`${this.apiUrl}/subscriptions`, {
      params: httpParams,
    });
  }

  getSubscriptionsSummary(): Observable<SubscriptionsSummaryResponse> {
    return this.http.get<SubscriptionsSummaryResponse>(`${this.apiUrl}/subscriptions/summary`);
  }

  /**
   * Get a subscription by ID.
   */
  getSubscription(id: string): Observable<SubscriptionResponse> {
    return this.http.get<SubscriptionResponse>(`${this.apiUrl}/subscriptions/${id}`);
  }

  /**
   * Create a new subscription.
   */
  createSubscription(subscription: CreateSubscriptionDto): Observable<SubscriptionResponse> {
    return this.http.post<SubscriptionResponse>(`${this.apiUrl}/subscriptions`, subscription);
  }

  /**
   * Cancel a subscription.
   */
  cancelSubscription(id: string, dto?: CancelSubscriptionDto): Observable<SubscriptionResponse> {
    return this.http.post<SubscriptionResponse>(`${this.apiUrl}/subscriptions/${id}/cancel`, dto ?? {});
  }

  /**
   * Statutory withdrawal of a subscription.
   */
  withdrawSubscription(id: string, dto?: WithdrawSubscriptionDto): Observable<SubscriptionResponse> {
    return this.http.post<SubscriptionResponse>(`${this.apiUrl}/subscriptions/${id}/withdraw`, dto ?? {});
  }

  /**
   * Resume a pending-cancel subscription.
   */
  resumeSubscription(id: string, dto?: ResumeSubscriptionDto): Observable<SubscriptionResponse> {
    return this.http.post<SubscriptionResponse>(`${this.apiUrl}/subscriptions/${id}/resume`, dto ?? {});
  }

  /**
   * Report whether a subscription can be reconfigured, plus the server types and addons the plan offers.
   */
  getConfigChangeEligibility(id: string): Observable<ConfigChangeEligibility> {
    return this.http.get<ConfigChangeEligibility>(`${this.apiUrl}/subscriptions/${id}/config-change/eligibility`);
  }

  /**
   * Advisory preview of a configuration change; final amounts are recalculated on submit.
   */
  previewConfigChange(id: string, request: ConfigChangeRequest): Observable<ConfigChangePreviewResponse> {
    return this.http.post<ConfigChangePreviewResponse>(
      `${this.apiUrl}/subscriptions/${id}/config-change/preview`,
      request,
    );
  }

  /**
   * Request a configuration change; the change is applied asynchronously.
   */
  submitConfigChange(id: string, request: ConfigChangeRequest): Observable<ConfigChangeResponse> {
    return this.http.post<ConfigChangeResponse>(`${this.apiUrl}/subscriptions/${id}/config-change`, request);
  }
}
