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
  loadMoreAdminSubscriptions,
} from './admin-subscriptions.actions';
import {
  selectAdminSubscriptions,
  selectAdminSubscriptionsAppendError,
  selectAdminSubscriptionsAppendLoading,
  selectAdminSubscriptionsCanceling,
  selectAdminSubscriptionsError,
  selectAdminSubscriptionsHasMore,
  selectAdminSubscriptionsInstantCanceling,
  selectAdminSubscriptionsLoading,
  selectAdminSubscriptionsResuming,
  selectAdminSubscriptionsState,
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
  readonly hasMore$ = this.store.select(selectAdminSubscriptionsHasMore);
  readonly appendLoading$ = this.store.select(selectAdminSubscriptionsAppendLoading);
  readonly appendError$ = this.store.select(selectAdminSubscriptionsAppendError);

  loadSubscriptions(params?: { search?: string; userId?: string }): void {
    this.store.dispatch(loadAdminSubscriptions(params ?? {}));
  }

  loadMore(): void {
    this.store
      .select(selectAdminSubscriptionsState)
      .pipe(take(1))
      .subscribe((state) => {
        if (!state.hasMore || state.appendLoading || state.loading) return;

        this.store.dispatch(
          loadMoreAdminSubscriptions({
            offset: state.nextOffset,
            search: state.search ?? undefined,
            userId: state.userId ?? undefined,
          }),
        );
      });
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
