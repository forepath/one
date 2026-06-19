import { createAction, props } from '@ngrx/store';

import type {
  AvailabilityCheckDto,
  AvailabilityResponse,
  PricingPreviewDto,
  PricingPreviewResponse,
} from '../../types/billing.types';

// Check Availability Actions
export const checkAvailability = createAction(
  '[Availability] Check Availability',
  props<{ check: AvailabilityCheckDto }>(),
);

export const checkAvailabilitySuccess = createAction(
  '[Availability] Check Availability Success',
  props<{ response: AvailabilityResponse }>(),
);

export const checkAvailabilityFailure = createAction(
  '[Availability] Check Availability Failure',
  props<{ error: string }>(),
);

// Check Availability with Alternatives Actions
export const checkAvailabilityAlternatives = createAction(
  '[Availability] Check Availability Alternatives',
  props<{ check: AvailabilityCheckDto }>(),
);

export const checkAvailabilityAlternativesSuccess = createAction(
  '[Availability] Check Availability Alternatives Success',
  props<{ response: AvailabilityResponse }>(),
);

export const checkAvailabilityAlternativesFailure = createAction(
  '[Availability] Check Availability Alternatives Failure',
  props<{ error: string }>(),
);

// Preview Pricing Actions
export const previewPricing = createAction('[Availability] Preview Pricing', props<{ preview: PricingPreviewDto }>());

export const previewPricingSuccess = createAction(
  '[Availability] Preview Pricing Success',
  props<{ response: PricingPreviewResponse }>(),
);

export const previewPricingFailure = createAction('[Availability] Preview Pricing Failure', props<{ error: string }>());

// Clear Availability Actions
export const clearAvailability = createAction('[Availability] Clear Availability');
