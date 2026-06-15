import { createAction, props } from '@ngrx/store';

import type {
  CreateServiceTypeDto,
  ListParams,
  ProviderDetail,
  ServiceTypeResponse,
  UpdateServiceTypeDto,
} from '../../types/billing.types';

// Load Provider Details Actions
export const loadProviderDetails = createAction('[Service Types] Load Provider Details');

export const loadProviderDetailsSuccess = createAction(
  '[Service Types] Load Provider Details Success',
  props<{ providerDetails: ProviderDetail[] }>(),
);

export const loadProviderDetailsFailure = createAction(
  '[Service Types] Load Provider Details Failure',
  props<{ error: string }>(),
);

// Load Service Types Actions
export const loadServiceTypes = createAction('[Service Types] Load Service Types', props<{ params?: ListParams }>());

export const loadServiceTypesSuccess = createAction(
  '[Service Types] Load Service Types Success',
  props<{ serviceTypes: ServiceTypeResponse[] }>(),
);

export const loadServiceTypesFailure = createAction(
  '[Service Types] Load Service Types Failure',
  props<{ error: string }>(),
);

export const loadServiceTypesBatch = createAction(
  '[Service Types] Load Service Types Batch',
  props<{ offset: number; accumulatedServiceTypes: ServiceTypeResponse[] }>(),
);

// Get Service Type by ID Actions
export const loadServiceType = createAction('[Service Types] Load Service Type', props<{ id: string }>());

export const loadServiceTypeSuccess = createAction(
  '[Service Types] Load Service Type Success',
  props<{ serviceType: ServiceTypeResponse }>(),
);

export const loadServiceTypeFailure = createAction(
  '[Service Types] Load Service Type Failure',
  props<{ error: string }>(),
);

// Create Service Type Actions
export const createServiceType = createAction(
  '[Service Types] Create Service Type',
  props<{ serviceType: CreateServiceTypeDto }>(),
);

export const createServiceTypeSuccess = createAction(
  '[Service Types] Create Service Type Success',
  props<{ serviceType: ServiceTypeResponse }>(),
);

export const createServiceTypeFailure = createAction(
  '[Service Types] Create Service Type Failure',
  props<{ error: string }>(),
);

// Update Service Type Actions
export const updateServiceType = createAction(
  '[Service Types] Update Service Type',
  props<{ id: string; serviceType: UpdateServiceTypeDto }>(),
);

export const updateServiceTypeSuccess = createAction(
  '[Service Types] Update Service Type Success',
  props<{ serviceType: ServiceTypeResponse }>(),
);

export const updateServiceTypeFailure = createAction(
  '[Service Types] Update Service Type Failure',
  props<{ error: string }>(),
);

// Delete Service Type Actions
export const deleteServiceType = createAction('[Service Types] Delete Service Type', props<{ id: string }>());

export const deleteServiceTypeSuccess = createAction(
  '[Service Types] Delete Service Type Success',
  props<{ id: string }>(),
);

export const deleteServiceTypeFailure = createAction(
  '[Service Types] Delete Service Type Failure',
  props<{ error: string }>(),
);

// Clear Selected Service Type Actions
export const clearSelectedServiceType = createAction('[Service Types] Clear Selected Service Type');
