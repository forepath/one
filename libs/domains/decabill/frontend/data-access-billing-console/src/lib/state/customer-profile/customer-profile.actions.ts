import { createAction, props } from '@ngrx/store';

import type { CustomerProfileDto, CustomerProfileResponse } from '../../types/billing.types';

// Load Customer Profile Actions
export const loadCustomerProfile = createAction('[Customer Profile] Load Customer Profile');

export const loadCustomerProfileSuccess = createAction(
  '[Customer Profile] Load Customer Profile Success',
  props<{ profile: CustomerProfileResponse }>(),
);

export const loadCustomerProfileFailure = createAction(
  '[Customer Profile] Load Customer Profile Failure',
  props<{ error: string }>(),
);

// Update Customer Profile Actions
export const updateCustomerProfile = createAction(
  '[Customer Profile] Update Customer Profile',
  props<{ profile: CustomerProfileDto }>(),
);

export const updateCustomerProfileSuccess = createAction(
  '[Customer Profile] Update Customer Profile Success',
  props<{ profile: CustomerProfileResponse }>(),
);

export const updateCustomerProfileFailure = createAction(
  '[Customer Profile] Update Customer Profile Failure',
  props<{ error: string }>(),
);

export const setupAutoBilling = createAction('[Customer Profile] Setup Auto Billing');

export const setupAutoBillingSuccess = createAction(
  '[Customer Profile] Setup Auto Billing Success',
  props<{ setupUrl: string }>(),
);

export const setupAutoBillingFailure = createAction(
  '[Customer Profile] Setup Auto Billing Failure',
  props<{ error: string }>(),
);

export const enableAutoBilling = createAction('[Customer Profile] Enable Auto Billing');

export const enableAutoBillingSuccess = createAction(
  '[Customer Profile] Enable Auto Billing Success',
  props<{ profile: CustomerProfileResponse }>(),
);

export const enableAutoBillingFailure = createAction(
  '[Customer Profile] Enable Auto Billing Failure',
  props<{ error: string }>(),
);

export const disableAutoBilling = createAction('[Customer Profile] Disable Auto Billing');

export const disableAutoBillingSuccess = createAction(
  '[Customer Profile] Disable Auto Billing Success',
  props<{ profile: CustomerProfileResponse }>(),
);

export const disableAutoBillingFailure = createAction(
  '[Customer Profile] Disable Auto Billing Failure',
  props<{ error: string }>(),
);

// Clear Customer Profile Actions
export const clearCustomerProfile = createAction('[Customer Profile] Clear Customer Profile');
