import { createAction, props } from '@ngrx/store';

import type { AdminSubscriptionListItem } from '../../types/billing.types';

export const loadAdminSubscriptions = createAction(
  '[AdminSubscriptions] Load Subscriptions',
  props<{ search?: string; userId?: string }>(),
);
export const loadAdminSubscriptionsBatch = createAction(
  '[AdminSubscriptions] Load Subscriptions Batch',
  props<{
    offset: number;
    accumulatedSubscriptions: AdminSubscriptionListItem[];
    search?: string;
    userId?: string;
  }>(),
);
export const loadAdminSubscriptionsSuccess = createAction(
  '[AdminSubscriptions] Load Subscriptions Success',
  props<{ subscriptions: AdminSubscriptionListItem[] }>(),
);
export const loadAdminSubscriptionsFailure = createAction(
  '[AdminSubscriptions] Load Subscriptions Failure',
  props<{ error: string }>(),
);

export const adminCancelSubscription = createAction(
  '[AdminSubscriptions] Cancel Subscription',
  props<{ id: string }>(),
);
export const adminCancelSubscriptionSuccess = createAction(
  '[AdminSubscriptions] Cancel Subscription Success',
  props<{ subscription: AdminSubscriptionListItem }>(),
);
export const adminCancelSubscriptionFailure = createAction(
  '[AdminSubscriptions] Cancel Subscription Failure',
  props<{ error: string }>(),
);

export const adminWithdrawSubscription = createAction(
  '[AdminSubscriptions] Withdraw Subscription',
  props<{ id: string }>(),
);
export const adminWithdrawSubscriptionSuccess = createAction(
  '[AdminSubscriptions] Withdraw Subscription Success',
  props<{ subscription: AdminSubscriptionListItem }>(),
);
export const adminWithdrawSubscriptionFailure = createAction(
  '[AdminSubscriptions] Withdraw Subscription Failure',
  props<{ error: string }>(),
);

export const adminResumeSubscription = createAction(
  '[AdminSubscriptions] Resume Subscription',
  props<{ id: string }>(),
);
export const adminResumeSubscriptionSuccess = createAction(
  '[AdminSubscriptions] Resume Subscription Success',
  props<{ subscription: AdminSubscriptionListItem }>(),
);
export const adminResumeSubscriptionFailure = createAction(
  '[AdminSubscriptions] Resume Subscription Failure',
  props<{ error: string }>(),
);
