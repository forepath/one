import { createAction, props } from '@ngrx/store';

import type {
  ConfirmPublicWithdrawalDto,
  PublicWithdrawalAddressee,
  PublicWithdrawalConfirmResponse,
  PublicWithdrawalRequestResponse,
  RequestPublicWithdrawalDto,
  VerifyPublicWithdrawalCodeDto,
} from '../../types/public-withdrawal.types';

export const loadPublicWithdrawalAddressee = createAction('[PublicWithdrawal] Load Addressee');

export const loadPublicWithdrawalAddresseeSuccess = createAction(
  '[PublicWithdrawal] Load Addressee Success',
  props<{ addressee: PublicWithdrawalAddressee }>(),
);

export const loadPublicWithdrawalAddresseeFailure = createAction(
  '[PublicWithdrawal] Load Addressee Failure',
  props<{ error: string }>(),
);

export const requestPublicWithdrawal = createAction(
  '[PublicWithdrawal] Request',
  props<{ dto: RequestPublicWithdrawalDto }>(),
);

export const requestPublicWithdrawalSuccess = createAction(
  '[PublicWithdrawal] Request Success',
  props<{ response: PublicWithdrawalRequestResponse }>(),
);

export const requestPublicWithdrawalFailure = createAction(
  '[PublicWithdrawal] Request Failure',
  props<{ error: string }>(),
);

export const verifyPublicWithdrawalCode = createAction(
  '[PublicWithdrawal] Verify Code',
  props<{ dto: VerifyPublicWithdrawalCodeDto }>(),
);

export const verifyPublicWithdrawalCodeSuccess = createAction(
  '[PublicWithdrawal] Verify Code Success',
  props<{ message: string }>(),
);

export const verifyPublicWithdrawalCodeFailure = createAction(
  '[PublicWithdrawal] Verify Code Failure',
  props<{ error: string }>(),
);

export const confirmPublicWithdrawal = createAction(
  '[PublicWithdrawal] Confirm',
  props<{ dto: ConfirmPublicWithdrawalDto }>(),
);

export const confirmPublicWithdrawalSuccess = createAction(
  '[PublicWithdrawal] Confirm Success',
  props<{ response: PublicWithdrawalConfirmResponse }>(),
);

export const confirmPublicWithdrawalFailure = createAction(
  '[PublicWithdrawal] Confirm Failure',
  props<{ error: string }>(),
);

export const resetPublicWithdrawal = createAction('[PublicWithdrawal] Reset');

export const clearPublicWithdrawalError = createAction('[PublicWithdrawal] Clear Error');

export const clearPublicWithdrawalSuccessMessage = createAction('[PublicWithdrawal] Clear Success Message');
