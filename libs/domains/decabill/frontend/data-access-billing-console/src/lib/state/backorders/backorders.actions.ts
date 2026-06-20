import { createAction, props } from '@ngrx/store';

import type { BackorderCancelDto, BackorderRetryDto, ListParams, BackorderResponse } from '../../types/billing.types';

// Load Backorders Actions
export const loadBackorders = createAction('[Backorders] Load Backorders', props<{ params?: ListParams }>());

export const loadBackordersSuccess = createAction(
  '[Backorders] Load Backorders Success',
  props<{ backorders: BackorderResponse[] }>(),
);

export const loadBackordersFailure = createAction('[Backorders] Load Backorders Failure', props<{ error: string }>());

export const loadBackordersBatch = createAction(
  '[Backorders] Load Backorders Batch',
  props<{ offset: number; accumulatedBackorders: BackorderResponse[] }>(),
);

// Retry Backorder Actions
export const retryBackorder = createAction(
  '[Backorders] Retry Backorder',
  props<{ id: string; dto?: BackorderRetryDto }>(),
);

export const retryBackorderSuccess = createAction(
  '[Backorders] Retry Backorder Success',
  props<{ backorder: BackorderResponse }>(),
);

export const retryBackorderFailure = createAction('[Backorders] Retry Backorder Failure', props<{ error: string }>());

// Cancel Backorder Actions
export const cancelBackorder = createAction(
  '[Backorders] Cancel Backorder',
  props<{ id: string; dto?: BackorderCancelDto }>(),
);

export const cancelBackorderSuccess = createAction(
  '[Backorders] Cancel Backorder Success',
  props<{ backorder: BackorderResponse }>(),
);

export const cancelBackorderFailure = createAction('[Backorders] Cancel Backorder Failure', props<{ error: string }>());

// Clear Selected Backorder Actions
export const clearSelectedBackorder = createAction('[Backorders] Clear Selected Backorder');
