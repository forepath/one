import { createReducer, on } from '@ngrx/store';

import type { CustomerProfileResponse } from '../../types/billing.types';

import {
  clearCustomerProfile,
  loadCustomerProfile,
  loadCustomerProfileFailure,
  loadCustomerProfileSuccess,
  updateCustomerProfile,
  updateCustomerProfileFailure,
  updateCustomerProfileSuccess,
} from './customer-profile.actions';

export interface CustomerProfileState {
  profile: CustomerProfileResponse | null;
  loading: boolean;
  updating: boolean;
  error: string | null;
}

export const initialCustomerProfileState: CustomerProfileState = {
  profile: null,
  loading: false,
  updating: false,
  error: null,
};

export const customerProfileReducer = createReducer(
  initialCustomerProfileState,
  on(loadCustomerProfile, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),
  on(loadCustomerProfileSuccess, (state, { profile }) => ({
    ...state,
    profile,
    loading: false,
    error: null,
  })),
  on(loadCustomerProfileFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),
  on(updateCustomerProfile, (state) => ({
    ...state,
    updating: true,
    error: null,
  })),
  on(updateCustomerProfileSuccess, (state, { profile }) => ({
    ...state,
    profile,
    updating: false,
    error: null,
  })),
  on(updateCustomerProfileFailure, (state, { error }) => ({
    ...state,
    updating: false,
    error,
  })),
  on(clearCustomerProfile, () => initialCustomerProfileState),
);
