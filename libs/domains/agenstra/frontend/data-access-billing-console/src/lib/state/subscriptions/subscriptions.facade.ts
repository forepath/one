import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';

import type {
  CancelSubscriptionDto,
  CreateSubscriptionDto,
  ListParams,
  ResumeSubscriptionDto,
  SubscriptionResponse,
} from '../../types/billing.types';

import {
  cancelSubscription,
  clearSelectedSubscription,
  createSubscription,
  loadSubscription,
  loadSubscriptions,
  resumeSubscription,
} from './subscriptions.actions';
import {
  selectActiveSubscriptions,
  selectHasSubscriptions,
  selectPendingCancelSubscriptions,
  selectSelectedSubscription,
  selectSubscriptionById,
  selectSubscriptionLoading,
  selectSubscriptionsByPlanId,
  selectSubscriptionsByStatus,
  selectSubscriptionsCanceling,
  selectSubscriptionsCount,
  selectSubscriptionsCreating,
  selectSubscriptionsEntities,
  selectSubscriptionsError,
  selectSubscriptionsLoading,
  selectSubscriptionsLoadingAny,
  selectSubscriptionsResuming,
} from './subscriptions.selectors';

@Injectable({
  providedIn: 'root',
})
export class SubscriptionsFacade {
  private readonly store = inject(Store);

  getSubscriptions$(): Observable<SubscriptionResponse[]> {
    return this.store.select(selectSubscriptionsEntities);
  }

  getSelectedSubscription$(): Observable<SubscriptionResponse | null> {
    return this.store.select(selectSelectedSubscription);
  }

  getSubscriptionsLoading$(): Observable<boolean> {
    return this.store.select(selectSubscriptionsLoading);
  }

  getSubscriptionLoading$(): Observable<boolean> {
    return this.store.select(selectSubscriptionLoading);
  }

  getSubscriptionsCreating$(): Observable<boolean> {
    return this.store.select(selectSubscriptionsCreating);
  }

  getSubscriptionsCanceling$(): Observable<boolean> {
    return this.store.select(selectSubscriptionsCanceling);
  }

  getSubscriptionsResuming$(): Observable<boolean> {
    return this.store.select(selectSubscriptionsResuming);
  }

  getSubscriptionsLoadingAny$(): Observable<boolean> {
    return this.store.select(selectSubscriptionsLoadingAny);
  }

  getSubscriptionsError$(): Observable<string | null> {
    return this.store.select(selectSubscriptionsError);
  }

  getSubscriptionsCount$(): Observable<number> {
    return this.store.select(selectSubscriptionsCount);
  }

  hasSubscriptions$(): Observable<boolean> {
    return this.store.select(selectHasSubscriptions);
  }

  getSubscriptionById$(id: string): Observable<SubscriptionResponse | undefined> {
    return this.store.select(selectSubscriptionById(id));
  }

  getSubscriptionsByPlanId$(planId: string): Observable<SubscriptionResponse[]> {
    return this.store.select(selectSubscriptionsByPlanId(planId));
  }

  getSubscriptionsByStatus$(status: string): Observable<SubscriptionResponse[]> {
    return this.store.select(selectSubscriptionsByStatus(status));
  }

  getActiveSubscriptions$(): Observable<SubscriptionResponse[]> {
    return this.store.select(selectActiveSubscriptions);
  }

  getPendingCancelSubscriptions$(): Observable<SubscriptionResponse[]> {
    return this.store.select(selectPendingCancelSubscriptions);
  }

  loadSubscriptions(params?: ListParams): void {
    this.store.dispatch(loadSubscriptions({ params }));
  }

  loadSubscription(id: string): void {
    this.store.dispatch(loadSubscription({ id }));
  }

  createSubscription(subscription: CreateSubscriptionDto): void {
    this.store.dispatch(createSubscription({ subscription }));
  }

  cancelSubscription(id: string, dto?: CancelSubscriptionDto): void {
    this.store.dispatch(cancelSubscription({ id, dto }));
  }

  resumeSubscription(id: string, dto?: ResumeSubscriptionDto): void {
    this.store.dispatch(resumeSubscription({ id, dto }));
  }

  clearSelectedSubscription(): void {
    this.store.dispatch(clearSelectedSubscription());
  }
}
