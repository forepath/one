import { createAction, props } from '@ngrx/store';

import type {
  CreateServicePlanDto,
  ListParams,
  ServicePlanResponse,
  UpdateServicePlanDto,
} from '../../types/billing.types';

// Load Service Plans Actions
export const loadServicePlans = createAction('[Service Plans] Load Service Plans', props<{ params?: ListParams }>());

export const loadServicePlansSuccess = createAction(
  '[Service Plans] Load Service Plans Success',
  props<{ servicePlans: ServicePlanResponse[] }>(),
);

export const loadServicePlansFailure = createAction(
  '[Service Plans] Load Service Plans Failure',
  props<{ error: string }>(),
);

export const loadServicePlansBatch = createAction(
  '[Service Plans] Load Service Plans Batch',
  props<{ offset: number; accumulatedServicePlans: ServicePlanResponse[] }>(),
);

// Get Service Plan by ID Actions
export const loadServicePlan = createAction('[Service Plans] Load Service Plan', props<{ id: string }>());

export const loadServicePlanSuccess = createAction(
  '[Service Plans] Load Service Plan Success',
  props<{ servicePlan: ServicePlanResponse }>(),
);

export const loadServicePlanFailure = createAction(
  '[Service Plans] Load Service Plan Failure',
  props<{ error: string }>(),
);

// Create Service Plan Actions
export const createServicePlan = createAction(
  '[Service Plans] Create Service Plan',
  props<{ servicePlan: CreateServicePlanDto }>(),
);

export const createServicePlanSuccess = createAction(
  '[Service Plans] Create Service Plan Success',
  props<{ servicePlan: ServicePlanResponse }>(),
);

export const createServicePlanFailure = createAction(
  '[Service Plans] Create Service Plan Failure',
  props<{ error: string }>(),
);

// Update Service Plan Actions
export const updateServicePlan = createAction(
  '[Service Plans] Update Service Plan',
  props<{ id: string; servicePlan: UpdateServicePlanDto }>(),
);

export const updateServicePlanSuccess = createAction(
  '[Service Plans] Update Service Plan Success',
  props<{ servicePlan: ServicePlanResponse }>(),
);

export const updateServicePlanFailure = createAction(
  '[Service Plans] Update Service Plan Failure',
  props<{ error: string }>(),
);

// Delete Service Plan Actions
export const deleteServicePlan = createAction('[Service Plans] Delete Service Plan', props<{ id: string }>());

export const deleteServicePlanSuccess = createAction(
  '[Service Plans] Delete Service Plan Success',
  props<{ id: string }>(),
);

export const deleteServicePlanFailure = createAction(
  '[Service Plans] Delete Service Plan Failure',
  props<{ error: string }>(),
);

// Clear Selected Service Plan Actions
export const clearSelectedServicePlan = createAction('[Service Plans] Clear Selected Service Plan');
