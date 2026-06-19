import { createReducer, on } from '@ngrx/store';

import type { ProviderDetail, ServiceTypeResponse } from '../../types/billing.types';

import {
  clearSelectedServiceType,
  createServiceType,
  createServiceTypeFailure,
  createServiceTypeSuccess,
  deleteServiceType,
  deleteServiceTypeFailure,
  deleteServiceTypeSuccess,
  loadProviderDetails,
  loadProviderDetailsFailure,
  loadProviderDetailsSuccess,
  loadServiceType,
  loadServiceTypeFailure,
  loadServiceTypes,
  loadServiceTypesBatch,
  loadServiceTypesFailure,
  loadServiceTypesSuccess,
  loadServiceTypeSuccess,
  updateServiceType,
  updateServiceTypeFailure,
  updateServiceTypeSuccess,
} from './service-types.actions';

export interface ServiceTypesState {
  entities: ServiceTypeResponse[];
  selectedServiceType: ServiceTypeResponse | null;
  providerDetails: ProviderDetail[];
  providerDetailsLoading: boolean;
  providerDetailsError: string | null;
  loading: boolean;
  loadingServiceType: boolean;
  creating: boolean;
  updating: boolean;
  deleting: boolean;
  error: string | null;
}

export const initialServiceTypesState: ServiceTypesState = {
  entities: [],
  selectedServiceType: null,
  providerDetails: [],
  providerDetailsLoading: false,
  providerDetailsError: null,
  loading: false,
  loadingServiceType: false,
  creating: false,
  updating: false,
  deleting: false,
  error: null,
};

export const serviceTypesReducer = createReducer(
  initialServiceTypesState,
  // Load Provider Details
  on(loadProviderDetails, (state) => ({
    ...state,
    providerDetailsLoading: true,
    providerDetailsError: null,
  })),
  on(loadProviderDetailsSuccess, (state, { providerDetails }) => ({
    ...state,
    providerDetails,
    providerDetailsLoading: false,
    providerDetailsError: null,
  })),
  on(loadProviderDetailsFailure, (state, { error }) => ({
    ...state,
    providerDetailsLoading: false,
    providerDetailsError: error,
  })),
  // Load Service Types
  on(loadServiceTypes, (state) => ({
    ...state,
    entities: [],
    loading: true,
    error: null,
  })),
  on(loadServiceTypesBatch, (state, { accumulatedServiceTypes }) => ({
    ...state,
    entities: accumulatedServiceTypes,
    loading: true,
    error: null,
  })),
  on(loadServiceTypesSuccess, (state, { serviceTypes }) => ({
    ...state,
    entities: serviceTypes,
    loading: false,
    error: null,
  })),
  on(loadServiceTypesFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),
  // Load Service Type by ID
  on(loadServiceType, (state) => ({
    ...state,
    loadingServiceType: true,
    error: null,
  })),
  on(loadServiceTypeSuccess, (state, { serviceType }) => {
    const existingIndex = state.entities.findIndex((st) => st.id === serviceType.id);
    const entities =
      existingIndex >= 0
        ? state.entities.map((st) => (st.id === serviceType.id ? serviceType : st))
        : [...state.entities, serviceType];

    return {
      ...state,
      entities,
      selectedServiceType: serviceType,
      loadingServiceType: false,
      error: null,
    };
  }),
  on(loadServiceTypeFailure, (state, { error }) => ({
    ...state,
    loadingServiceType: false,
    error,
  })),
  // Create Service Type
  on(createServiceType, (state) => ({
    ...state,
    creating: true,
    error: null,
  })),
  on(createServiceTypeSuccess, (state, { serviceType }) => ({
    ...state,
    entities: [...state.entities, serviceType],
    selectedServiceType: serviceType,
    creating: false,
    error: null,
  })),
  on(createServiceTypeFailure, (state, { error }) => ({
    ...state,
    creating: false,
    error,
  })),
  // Update Service Type
  on(updateServiceType, (state) => ({
    ...state,
    updating: true,
    error: null,
  })),
  on(updateServiceTypeSuccess, (state, { serviceType }) => ({
    ...state,
    entities: state.entities.map((st) => (st.id === serviceType.id ? serviceType : st)),
    selectedServiceType: state.selectedServiceType?.id === serviceType.id ? serviceType : state.selectedServiceType,
    updating: false,
    error: null,
  })),
  on(updateServiceTypeFailure, (state, { error }) => ({
    ...state,
    updating: false,
    error,
  })),
  // Delete Service Type
  on(deleteServiceType, (state) => ({
    ...state,
    deleting: true,
    error: null,
  })),
  on(deleteServiceTypeSuccess, (state, { id }) => ({
    ...state,
    entities: state.entities.filter((st) => st.id !== id),
    selectedServiceType: state.selectedServiceType?.id === id ? null : state.selectedServiceType,
    deleting: false,
    error: null,
  })),
  on(deleteServiceTypeFailure, (state, { error }) => ({
    ...state,
    deleting: false,
    error,
  })),
  // Clear Selected Service Type
  on(clearSelectedServiceType, (state) => ({
    ...state,
    selectedServiceType: null,
  })),
);
