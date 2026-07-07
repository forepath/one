import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Environment } from '@forepath/shared/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';
import { Observable } from 'rxjs';

import type {
  CancelSubscriptionDto,
  CreateSubscriptionDto,
  ListParams,
  ResumeSubscriptionDto,
  SubscriptionResponse,
  WithdrawSubscriptionDto,
} from '../types/billing.types';

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
    return this.environment.billing.restApiUrl;
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

    return this.http.get<SubscriptionResponse[]>(`${this.apiUrl}/subscriptions`, {
      params: httpParams,
    });
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
}
