import { createReducer, on } from '@ngrx/store';

import type { PublicServicePlanOffering } from '../../types/portal-service-plans.types';

import {
  loadCheapestServicePlanOffering,
  loadCheapestServicePlanOfferingFailure,
  loadCheapestServicePlanOfferingSuccess,
  loadServicePlans,
  loadServicePlansBatch,
  loadServicePlansFailure,
  loadServicePlansSuccess,
} from './service-plans.actions';

export interface ServicePlansState {
  entities: PublicServicePlanOffering[];
  cheapestOffering: PublicServicePlanOffering | null;
  loading: boolean;
  loadingCheapest: boolean;
  plansLoaded: boolean;
  cheapestLoaded: boolean;
  plansError: string | null;
  cheapestError: string | null;
}

export const initialServicePlansState: ServicePlansState = {
  entities: [],
  cheapestOffering: null,
  loading: false,
  loadingCheapest: false,
  plansLoaded: false,
  cheapestLoaded: false,
  plansError: null,
  cheapestError: null,
};

export const servicePlansReducer = createReducer(
  initialServicePlansState,
  on(loadServicePlans, (state) => ({
    ...state,
    loading: true,
    plansError: null,
  })),
  on(loadServicePlansBatch, (state, { accumulatedServicePlans }) => ({
    ...state,
    entities: accumulatedServicePlans,
    loading: true,
    plansError: null,
  })),
  on(loadServicePlansSuccess, (state, { servicePlans }) => ({
    ...state,
    entities: servicePlans,
    loading: false,
    plansLoaded: true,
    plansError: null,
  })),
  on(loadServicePlansFailure, (state, { error }) => ({
    ...state,
    loading: false,
    plansLoaded: true,
    plansError: error,
  })),
  on(loadCheapestServicePlanOffering, (state) => ({
    ...state,
    loadingCheapest: true,
    cheapestError: null,
  })),
  on(loadCheapestServicePlanOfferingSuccess, (state, { offering }) => ({
    ...state,
    cheapestOffering: offering,
    loadingCheapest: false,
    cheapestLoaded: true,
    cheapestError: null,
  })),
  on(loadCheapestServicePlanOfferingFailure, (state, { error }) => ({
    ...state,
    loadingCheapest: false,
    cheapestLoaded: true,
    cheapestError: error,
  })),
);
