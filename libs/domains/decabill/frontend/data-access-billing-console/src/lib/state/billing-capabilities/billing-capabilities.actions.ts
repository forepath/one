import { createAction, props } from '@ngrx/store';

import type { BillingCapabilitiesResponse } from '../../types/billing.types';

export const loadBillingCapabilities = createAction('[BillingCapabilities] Load');
export const loadBillingCapabilitiesSuccess = createAction(
  '[BillingCapabilities] Load Success',
  props<{ capabilities: BillingCapabilitiesResponse }>(),
);
export const loadBillingCapabilitiesFailure = createAction(
  '[BillingCapabilities] Load Failure',
  props<{ error: string }>(),
);
