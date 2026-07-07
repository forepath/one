import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { PublicWithdrawalAddressee, PublicWithdrawalStep } from '../../types/public-withdrawal.types';

import type { PublicWithdrawalState } from './public-withdrawal.reducer';

export const selectPublicWithdrawalState = createFeatureSelector<PublicWithdrawalState>('publicWithdrawal');

export const selectPublicWithdrawalStep = createSelector(
  selectPublicWithdrawalState,
  (state): PublicWithdrawalStep => state.step,
);

export const selectPublicWithdrawalRequestId = createSelector(
  selectPublicWithdrawalState,
  (state): string | null => state.requestId,
);

export const selectPublicWithdrawalResumed = createSelector(
  selectPublicWithdrawalState,
  (state): boolean => state.resumed,
);

export const selectPublicWithdrawalAddressee = createSelector(
  selectPublicWithdrawalState,
  (state): PublicWithdrawalAddressee | null => state.addressee,
);

export const selectPublicWithdrawalAddresseeLoading = createSelector(
  selectPublicWithdrawalState,
  (state): boolean => state.addresseeLoading,
);

export const selectPublicWithdrawalAddresseeError = createSelector(
  selectPublicWithdrawalState,
  (state): string | null => state.addresseeError,
);

export const selectPublicWithdrawalLoading = createSelector(
  selectPublicWithdrawalState,
  (state): boolean => state.loading,
);

export const selectPublicWithdrawalVerifying = createSelector(
  selectPublicWithdrawalState,
  (state): boolean => state.verifying,
);

export const selectPublicWithdrawalConfirming = createSelector(
  selectPublicWithdrawalState,
  (state): boolean => state.confirming,
);

export const selectPublicWithdrawalError = createSelector(
  selectPublicWithdrawalState,
  (state): string | null => state.error,
);

export const selectPublicWithdrawalSuccessMessage = createSelector(
  selectPublicWithdrawalState,
  (state): string | null => state.successMessage,
);
