import { createReducer, on } from '@ngrx/store';

import type { AvailabilityResponse, PricingPreviewResponse } from '../../types/billing.types';

import {
  checkAvailability,
  checkAvailabilityAlternatives,
  checkAvailabilityAlternativesFailure,
  checkAvailabilityAlternativesSuccess,
  checkAvailabilityFailure,
  checkAvailabilitySuccess,
  clearAvailability,
  previewPricing,
  previewPricingFailure,
  previewPricingSuccess,
} from './availability.actions';

export interface AvailabilityState {
  availability: AvailabilityResponse | null;
  alternatives: AvailabilityResponse | null;
  pricing: PricingPreviewResponse | null;
  loadingAvailability: boolean;
  loadingAlternatives: boolean;
  loadingPricing: boolean;
  error: string | null;
}

export const initialAvailabilityState: AvailabilityState = {
  availability: null,
  alternatives: null,
  pricing: null,
  loadingAvailability: false,
  loadingAlternatives: false,
  loadingPricing: false,
  error: null,
};

export const availabilityReducer = createReducer(
  initialAvailabilityState,
  on(checkAvailability, (state) => ({
    ...state,
    loadingAvailability: true,
    error: null,
  })),
  on(checkAvailabilitySuccess, (state, { response }) => ({
    ...state,
    availability: response,
    loadingAvailability: false,
    error: null,
  })),
  on(checkAvailabilityFailure, (state, { error }) => ({
    ...state,
    loadingAvailability: false,
    error,
  })),
  on(checkAvailabilityAlternatives, (state) => ({
    ...state,
    loadingAlternatives: true,
    error: null,
  })),
  on(checkAvailabilityAlternativesSuccess, (state, { response }) => ({
    ...state,
    alternatives: response,
    loadingAlternatives: false,
    error: null,
  })),
  on(checkAvailabilityAlternativesFailure, (state, { error }) => ({
    ...state,
    loadingAlternatives: false,
    error,
  })),
  on(previewPricing, (state) => ({
    ...state,
    loadingPricing: true,
    error: null,
  })),
  on(previewPricingSuccess, (state, { response }) => ({
    ...state,
    pricing: response,
    loadingPricing: false,
    error: null,
  })),
  on(previewPricingFailure, (state, { error }) => ({
    ...state,
    loadingPricing: false,
    error,
  })),
  on(clearAvailability, () => initialAvailabilityState),
);
