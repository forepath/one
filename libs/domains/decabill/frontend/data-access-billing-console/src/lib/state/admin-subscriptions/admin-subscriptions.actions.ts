import { createAction, props } from '@ngrx/store';

import type { AdminSubscriptionListItem, AdminSubscriptionTeardownOptions } from '../../types/billing.types';

export const loadAdminSubscriptions = createAction(
  '[AdminSubscriptions] Load Subscriptions',
  props<{ search?: string; userId?: string; page?: number; pageSize?: number }>(),
);
export const loadAdminSubscriptionsSuccess = createAction(
  '[AdminSubscriptions] Load Subscriptions Success',
  props<{ subscriptions: AdminSubscriptionListItem[]; total: number }>(),
);
export const loadAdminSubscriptionsFailure = createAction(
  '[AdminSubscriptions] Load Subscriptions Failure',
  props<{ error: string }>(),
);

export const adminCancelSubscription = createAction(
  '[AdminSubscriptions] Cancel Subscription',
  props<{ id: string; options?: AdminSubscriptionTeardownOptions }>(),
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
  props<{ id: string; options?: AdminSubscriptionTeardownOptions }>(),
);
export const adminWithdrawSubscriptionSuccess = createAction(
  '[AdminSubscriptions] Withdraw Subscription Success',
  props<{ subscription: AdminSubscriptionListItem }>(),
);
export const adminWithdrawSubscriptionFailure = createAction(
  '[AdminSubscriptions] Withdraw Subscription Failure',
  props<{ error: string }>(),
);

export const adminInstantCancelSubscription = createAction(
  '[AdminSubscriptions] Instant Cancel Subscription',
  props<{ id: string; options?: AdminSubscriptionTeardownOptions }>(),
);
export const adminInstantCancelSubscriptionSuccess = createAction(
  '[AdminSubscriptions] Instant Cancel Subscription Success',
  props<{ subscription: AdminSubscriptionListItem }>(),
);
export const adminInstantCancelSubscriptionFailure = createAction(
  '[AdminSubscriptions] Instant Cancel Subscription Failure',
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
