import { createAction, props } from '@ngrx/store';

import type {
  CancelSubscriptionDto,
  CreateSubscriptionDto,
  ListParams,
  ResumeSubscriptionDto,
  SubscriptionResponse,
  SubscriptionsSummaryResponse,
  WithdrawSubscriptionDto,
} from '../../types/billing.types';

// Load Subscriptions Actions
export const loadSubscriptions = createAction('[Subscriptions] Load Subscriptions', props<{ params?: ListParams }>());

export const loadSubscriptionsSuccess = createAction(
  '[Subscriptions] Load Subscriptions Success',
  props<{ subscriptions: SubscriptionResponse[]; hasMore: boolean }>(),
);

export const loadSubscriptionsFailure = createAction(
  '[Subscriptions] Load Subscriptions Failure',
  props<{ error: string }>(),
);

export const loadSubscriptionsSummary = createAction('[Subscriptions] Load Summary');

export const loadSubscriptionsSummarySuccess = createAction(
  '[Subscriptions] Load Summary Success',
  props<{ summary: SubscriptionsSummaryResponse }>(),
);

export const loadSubscriptionsSummaryFailure = createAction(
  '[Subscriptions] Load Summary Failure',
  props<{ error: string }>(),
);

// Get Subscription by ID Actions
export const loadSubscription = createAction('[Subscriptions] Load Subscription', props<{ id: string }>());

export const loadSubscriptionSuccess = createAction(
  '[Subscriptions] Load Subscription Success',
  props<{ subscription: SubscriptionResponse }>(),
);

export const loadSubscriptionFailure = createAction(
  '[Subscriptions] Load Subscription Failure',
  props<{ error: string }>(),
);

// Create Subscription Actions
export const createSubscription = createAction(
  '[Subscriptions] Create Subscription',
  props<{ subscription: CreateSubscriptionDto }>(),
);

export const createSubscriptionSuccess = createAction(
  '[Subscriptions] Create Subscription Success',
  props<{ subscription: SubscriptionResponse }>(),
);

export const createSubscriptionFailure = createAction(
  '[Subscriptions] Create Subscription Failure',
  props<{ error: string }>(),
);

// Cancel Subscription Actions
export const cancelSubscription = createAction(
  '[Subscriptions] Cancel Subscription',
  props<{ id: string; dto?: CancelSubscriptionDto }>(),
);

export const cancelSubscriptionSuccess = createAction(
  '[Subscriptions] Cancel Subscription Success',
  props<{ subscription: SubscriptionResponse }>(),
);

export const cancelSubscriptionFailure = createAction(
  '[Subscriptions] Cancel Subscription Failure',
  props<{ error: string }>(),
);

// Withdraw Subscription Actions
export const withdrawSubscription = createAction(
  '[Subscriptions] Withdraw Subscription',
  props<{ id: string; dto?: WithdrawSubscriptionDto }>(),
);

export const withdrawSubscriptionSuccess = createAction(
  '[Subscriptions] Withdraw Subscription Success',
  props<{ subscription: SubscriptionResponse }>(),
);

export const withdrawSubscriptionFailure = createAction(
  '[Subscriptions] Withdraw Subscription Failure',
  props<{ error: string }>(),
);

// Resume Subscription Actions
export const resumeSubscription = createAction(
  '[Subscriptions] Resume Subscription',
  props<{ id: string; dto?: ResumeSubscriptionDto }>(),
);

export const resumeSubscriptionSuccess = createAction(
  '[Subscriptions] Resume Subscription Success',
  props<{ subscription: SubscriptionResponse }>(),
);

export const resumeSubscriptionFailure = createAction(
  '[Subscriptions] Resume Subscription Failure',
  props<{ error: string }>(),
);

// Clear Selected Subscription Actions
export const clearSelectedSubscription = createAction('[Subscriptions] Clear Selected Subscription');
