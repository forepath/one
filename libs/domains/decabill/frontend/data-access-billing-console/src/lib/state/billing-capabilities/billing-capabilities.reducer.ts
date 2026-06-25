import { createReducer, on } from '@ngrx/store';

import type { BillingCapabilitiesResponse } from '../../types/billing.types';

import {
  loadBillingCapabilities,
  loadBillingCapabilitiesFailure,
  loadBillingCapabilitiesSuccess,
} from './billing-capabilities.actions';

export interface BillingCapabilitiesState {
  capabilities: BillingCapabilitiesResponse | null;
  loading: boolean;
  error: string | null;
}

export const initialBillingCapabilitiesState: BillingCapabilitiesState = {
  capabilities: null,
  loading: false,
  error: null,
};

export const billingCapabilitiesReducer = createReducer(
  initialBillingCapabilitiesState,
  on(loadBillingCapabilities, (state) => ({ ...state, loading: true, error: null })),
  on(loadBillingCapabilitiesSuccess, (state, { capabilities }) => ({
    ...state,
    capabilities,
    loading: false,
  })),
  on(loadBillingCapabilitiesFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),
);
