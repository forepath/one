import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { ServiceTypesState } from './service-types.reducer';

export const selectServiceTypesState = createFeatureSelector<ServiceTypesState>('serviceTypes');

// Base selectors
export const selectServiceTypesEntities = createSelector(selectServiceTypesState, (state) => state.entities);

export const selectSelectedServiceType = createSelector(selectServiceTypesState, (state) => state.selectedServiceType);

export const selectServiceTypesLoading = createSelector(selectServiceTypesState, (state) => state.loading);

export const selectServiceTypeLoading = createSelector(selectServiceTypesState, (state) => state.loadingServiceType);

export const selectServiceTypesCreating = createSelector(selectServiceTypesState, (state) => state.creating);

export const selectServiceTypesUpdating = createSelector(selectServiceTypesState, (state) => state.updating);

export const selectServiceTypesDeleting = createSelector(selectServiceTypesState, (state) => state.deleting);

export const selectServiceTypesError = createSelector(selectServiceTypesState, (state) => state.error);

export const selectProviderDetails = createSelector(selectServiceTypesState, (state) => state.providerDetails);

export const selectProviderDetailsLoading = createSelector(
  selectServiceTypesState,
  (state) => state.providerDetailsLoading,
);

export const selectProviderDetailsError = createSelector(
  selectServiceTypesState,
  (state) => state.providerDetailsError,
);

// Combined loading selector (true if any operation is loading)
export const selectServiceTypesLoadingAny = createSelector(
  selectServiceTypesLoading,
  selectServiceTypeLoading,
  selectProviderDetailsLoading,
  selectServiceTypesCreating,
  selectServiceTypesUpdating,
  selectServiceTypesDeleting,
  (loading, loadingServiceType, providerDetailsLoading, creating, updating, deleting) =>
    loading || loadingServiceType || providerDetailsLoading || creating || updating || deleting,
);

// Derived selectors
export const selectServiceTypesCount = createSelector(selectServiceTypesEntities, (entities) => entities.length);

export const selectServiceTypeById = (id: string) =>
  createSelector(selectServiceTypesEntities, (entities) => entities.find((st) => st.id === id));

export const selectServiceTypeByKey = (key: string) =>
  createSelector(selectServiceTypesEntities, (entities) => entities.find((st) => st.key === key));

export const selectHasServiceTypes = createSelector(selectServiceTypesEntities, (entities) => entities.length > 0);

export const selectActiveServiceTypes = createSelector(selectServiceTypesEntities, (entities) =>
  entities.filter((st) => st.isActive),
);
