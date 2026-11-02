import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { take } from 'rxjs';

import type { AdminSubscriptionTeardownOptions } from '../../types/billing.types';

import {
  adminCancelSubscription,
  adminInstantCancelSubscription,
  adminResumeSubscription,
  adminWithdrawSubscription,
  loadAdminSubscriptions,
} from './admin-subscriptions.actions';
import {
  selectAdminSubscriptions,
  selectAdminSubscriptionsCanceling,
  selectAdminSubscriptionsError,
  selectAdminSubscriptionsInstantCanceling,
  selectAdminSubscriptionsLoading,
  selectAdminSubscriptionsPage,
  selectAdminSubscriptionsPageSize,
  selectAdminSubscriptionsResuming,
  selectAdminSubscriptionsState,
  selectAdminSubscriptionsTotal,
  selectAdminSubscriptionsWithdrawing,
} from './admin-subscriptions.selectors';

@Injectable()
export class AdminSubscriptionsFacade {
  private readonly store = inject(Store);

  readonly subscriptions$ = this.store.select(selectAdminSubscriptions);
  readonly loading$ = this.store.select(selectAdminSubscriptionsLoading);
  readonly canceling$ = this.store.select(selectAdminSubscriptionsCanceling);
  readonly withdrawing$ = this.store.select(selectAdminSubscriptionsWithdrawing);
  readonly instantCanceling$ = this.store.select(selectAdminSubscriptionsInstantCanceling);
  readonly resuming$ = this.store.select(selectAdminSubscriptionsResuming);
  readonly error$ = this.store.select(selectAdminSubscriptionsError);
  readonly total$ = this.store.select(selectAdminSubscriptionsTotal);
  readonly page$ = this.store.select(selectAdminSubscriptionsPage);
  readonly pageSize$ = this.store.select(selectAdminSubscriptionsPageSize);

  /** Loads page 1 (or the given page) of the filtered list; the page replaces the current rows. */
  loadSubscriptions(params?: { search?: string; userId?: string; page?: number; pageSize?: number }): void {
    this.store.dispatch(loadAdminSubscriptions(params ?? {}));
  }

  /** Loads another page of the current filter (replace-page). */
  loadPage(page: number, pageSize?: number): void {
    this.store
      .select(selectAdminSubscriptionsState)
      .pipe(take(1))
      .subscribe((state) =>
        this.store.dispatch(
          loadAdminSubscriptions({
            search: state.search ?? undefined,
            userId: state.userId ?? undefined,
            page,
            pageSize: pageSize ?? state.pageSize,
          }),
        ),
      );
  }

  cancelSubscription(id: string, options?: AdminSubscriptionTeardownOptions): void {
    this.store.dispatch(adminCancelSubscription({ id, options }));
  }

  withdrawSubscription(id: string, options?: AdminSubscriptionTeardownOptions): void {
    this.store.dispatch(adminWithdrawSubscription({ id, options }));
  }

  instantCancelSubscription(id: string, options?: AdminSubscriptionTeardownOptions): void {
    this.store.dispatch(adminInstantCancelSubscription({ id, options }));
  }

  resumeSubscription(id: string): void {
    this.store.dispatch(adminResumeSubscription({ id }));
  }
}
