import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { ServicePlansState } from './service-plans.reducer';

export const selectServicePlansState = createFeatureSelector<ServicePlansState>('servicePlans');

export const selectServicePlansEntities = createSelector(selectServicePlansState, (state) => state.entities);

export const selectCheapestServicePlanOffering = createSelector(
  selectServicePlansState,
  (state) => state.cheapestOffering,
);

export const selectServicePlansLoading = createSelector(selectServicePlansState, (state) => state.loading);

export const selectCheapestServicePlanOfferingLoading = createSelector(
  selectServicePlansState,
  (state) => state.loadingCheapest,
);

export const selectServicePlansLoaded = createSelector(selectServicePlansState, (state) => state.plansLoaded);

export const selectCheapestServicePlanOfferingLoaded = createSelector(
  selectServicePlansState,
  (state) => state.cheapestLoaded,
);

export const selectServicePlansError = createSelector(selectServicePlansState, (state) => state.plansError);

export const selectCheapestServicePlanOfferingError = createSelector(
  selectServicePlansState,
  (state) => state.cheapestError,
);

export const selectServicePlansCount = createSelector(selectServicePlansEntities, (entities) => entities.length);

export const selectHasServicePlans = createSelector(selectServicePlansEntities, (entities) => entities.length > 0);

export const selectServicePlanById = (id: string) =>
  createSelector(selectServicePlansEntities, (entities) => entities.find((sp) => sp.id === id));

export const selectServicePlansByServiceTypeId = (serviceTypeId: string) =>
  createSelector(selectServicePlansEntities, (entities) => entities.filter((sp) => sp.serviceTypeId === serviceTypeId));
