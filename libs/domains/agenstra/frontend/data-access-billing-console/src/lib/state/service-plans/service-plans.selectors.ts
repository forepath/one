import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { ServicePlansState } from './service-plans.reducer';

export const selectServicePlansState = createFeatureSelector<ServicePlansState>('servicePlans');

// Base selectors
export const selectServicePlansEntities = createSelector(selectServicePlansState, (state) => state.entities);

export const selectSelectedServicePlan = createSelector(selectServicePlansState, (state) => state.selectedServicePlan);

export const selectServicePlansLoading = createSelector(selectServicePlansState, (state) => state.loading);

export const selectServicePlanLoading = createSelector(selectServicePlansState, (state) => state.loadingServicePlan);

export const selectServicePlansCreating = createSelector(selectServicePlansState, (state) => state.creating);

export const selectServicePlansUpdating = createSelector(selectServicePlansState, (state) => state.updating);

export const selectServicePlansDeleting = createSelector(selectServicePlansState, (state) => state.deleting);

export const selectServicePlansError = createSelector(selectServicePlansState, (state) => state.error);

// Combined loading selector
export const selectServicePlansLoadingAny = createSelector(
  selectServicePlansLoading,
  selectServicePlanLoading,
  selectServicePlansCreating,
  selectServicePlansUpdating,
  selectServicePlansDeleting,
  (loading, loadingServicePlan, creating, updating, deleting) =>
    loading || loadingServicePlan || creating || updating || deleting,
);

// Derived selectors
export const selectServicePlansCount = createSelector(selectServicePlansEntities, (entities) => entities.length);

export const selectServicePlanById = (id: string) =>
  createSelector(selectServicePlansEntities, (entities) => entities.find((sp) => sp.id === id));

export const selectServicePlansByServiceTypeId = (serviceTypeId: string) =>
  createSelector(selectServicePlansEntities, (entities) => entities.filter((sp) => sp.serviceTypeId === serviceTypeId));

export const selectHasServicePlans = createSelector(selectServicePlansEntities, (entities) => entities.length > 0);

export const selectActiveServicePlans = createSelector(selectServicePlansEntities, (entities) =>
  entities.filter((sp) => sp.isActive),
);
