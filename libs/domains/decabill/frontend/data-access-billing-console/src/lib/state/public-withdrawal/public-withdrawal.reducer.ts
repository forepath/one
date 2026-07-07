import { createReducer, on } from '@ngrx/store';

import type { PublicWithdrawalAddressee, PublicWithdrawalStep } from '../../types/public-withdrawal.types';

import {
  clearPublicWithdrawalError,
  clearPublicWithdrawalSuccessMessage,
  confirmPublicWithdrawal,
  confirmPublicWithdrawalFailure,
  confirmPublicWithdrawalSuccess,
  loadPublicWithdrawalAddressee,
  loadPublicWithdrawalAddresseeFailure,
  loadPublicWithdrawalAddresseeSuccess,
  requestPublicWithdrawal,
  requestPublicWithdrawalFailure,
  requestPublicWithdrawalSuccess,
  resetPublicWithdrawal,
  verifyPublicWithdrawalCode,
  verifyPublicWithdrawalCodeFailure,
  verifyPublicWithdrawalCodeSuccess,
} from './public-withdrawal.actions';

export interface PublicWithdrawalState {
  step: PublicWithdrawalStep;
  requestId: string | null;
  resumed: boolean;
  addressee: PublicWithdrawalAddressee | null;
  addresseeLoading: boolean;
  addresseeError: string | null;
  loading: boolean;
  verifying: boolean;
  confirming: boolean;
  error: string | null;
  successMessage: string | null;
}

export const initialPublicWithdrawalState: PublicWithdrawalState = {
  step: 'details',
  requestId: null,
  resumed: false,
  addressee: null,
  addresseeLoading: false,
  addresseeError: null,
  loading: false,
  verifying: false,
  confirming: false,
  error: null,
  successMessage: null,
};

export const publicWithdrawalReducer = createReducer(
  initialPublicWithdrawalState,
  on(loadPublicWithdrawalAddressee, (state) => ({
    ...state,
    addresseeLoading: true,
    addresseeError: null,
  })),
  on(loadPublicWithdrawalAddresseeSuccess, (state, { addressee }) => ({
    ...state,
    addressee,
    addresseeLoading: false,
    addresseeError: null,
  })),
  on(loadPublicWithdrawalAddresseeFailure, (state, { error }) => ({
    ...state,
    addresseeLoading: false,
    addresseeError: error,
  })),
  on(requestPublicWithdrawal, (state) => ({
    ...state,
    loading: true,
    error: null,
    successMessage: null,
  })),
  on(requestPublicWithdrawalSuccess, (state, { response }) => ({
    ...state,
    loading: false,
    requestId: response.requestId,
    resumed: response.resumed,
    step: response.resumeStep,
    successMessage: response.message,
    error: null,
  })),
  on(requestPublicWithdrawalFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),
  on(verifyPublicWithdrawalCode, (state) => ({
    ...state,
    verifying: true,
    error: null,
  })),
  on(verifyPublicWithdrawalCodeSuccess, (state, { message }) => ({
    ...state,
    verifying: false,
    step: 'acknowledge',
    successMessage: message,
    error: null,
  })),
  on(verifyPublicWithdrawalCodeFailure, (state, { error }) => ({
    ...state,
    verifying: false,
    error,
  })),
  on(confirmPublicWithdrawal, (state) => ({
    ...state,
    confirming: true,
    error: null,
  })),
  on(confirmPublicWithdrawalSuccess, (state, { response }) => ({
    ...state,
    confirming: false,
    step: 'done',
    successMessage: response.message,
    error: null,
  })),
  on(confirmPublicWithdrawalFailure, (state, { error }) => ({
    ...state,
    confirming: false,
    error,
  })),
  on(clearPublicWithdrawalError, (state) => ({
    ...state,
    error: null,
  })),
  on(clearPublicWithdrawalSuccessMessage, (state) => ({
    ...state,
    successMessage: null,
  })),
  on(resetPublicWithdrawal, () => initialPublicWithdrawalState),
);
