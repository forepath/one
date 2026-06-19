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

// Clear Customer Profile Actions
export const clearCustomerProfile = createAction('[Customer Profile] Clear Customer Profile');
