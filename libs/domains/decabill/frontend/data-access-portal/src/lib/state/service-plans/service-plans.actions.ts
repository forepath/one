import { createAction, props } from '@ngrx/store';

import type {
  PublicServicePlanOffering,
  PublicServicePlanOfferingsListParams,
} from '../../types/portal-service-plans.types';

export const loadServicePlans = createAction(
  '[Service Plans] Load Service Plans',
  props<{ params?: PublicServicePlanOfferingsListParams }>(),
);

export const loadServicePlansSuccess = createAction(
  '[Service Plans] Load Service Plans Success',
  props<{ servicePlans: PublicServicePlanOffering[] }>(),
);

export const loadServicePlansFailure = createAction(
  '[Service Plans] Load Service Plans Failure',
  props<{ error: string }>(),
);

export const loadServicePlansBatch = createAction(
  '[Service Plans] Load Service Plans Batch',
  props<{ offset: number; accumulatedServicePlans: PublicServicePlanOffering[] }>(),
);

export const loadCheapestServicePlanOffering = createAction(
  '[Service Plans] Load Cheapest Service Plan Offering',
  props<{ serviceTypeId?: string }>(),
);

export const loadCheapestServicePlanOfferingSuccess = createAction(
  '[Service Plans] Load Cheapest Service Plan Offering Success',
  props<{ offering: PublicServicePlanOffering }>(),
);

export const loadCheapestServicePlanOfferingFailure = createAction(
  '[Service Plans] Load Cheapest Service Plan Offering Failure',
  props<{ error: string }>(),
);
