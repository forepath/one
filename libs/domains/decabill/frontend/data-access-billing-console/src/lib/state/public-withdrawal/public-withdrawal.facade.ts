import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';

import type {
  ConfirmPublicWithdrawalDto,
  PublicWithdrawalAddressee,
  PublicWithdrawalStep,
  RequestPublicWithdrawalDto,
  VerifyPublicWithdrawalCodeDto,
} from '../../types/public-withdrawal.types';

import {
  clearPublicWithdrawalError,
  clearPublicWithdrawalSuccessMessage,
  confirmPublicWithdrawal,
  loadPublicWithdrawalAddressee,
  requestPublicWithdrawal,
  verifyPublicWithdrawalCode,
} from './public-withdrawal.actions';
import {
  selectPublicWithdrawalAddressee,
  selectPublicWithdrawalAddresseeError,
  selectPublicWithdrawalAddresseeLoading,
  selectPublicWithdrawalConfirming,
  selectPublicWithdrawalError,
  selectPublicWithdrawalLoading,
  selectPublicWithdrawalRequestId,
  selectPublicWithdrawalResumed,
  selectPublicWithdrawalStep,
  selectPublicWithdrawalSuccessMessage,
  selectPublicWithdrawalVerifying,
} from './public-withdrawal.selectors';

@Injectable()
export class PublicWithdrawalFacade {
  private readonly store = inject(Store);

  readonly step$: Observable<PublicWithdrawalStep> = this.store.select(selectPublicWithdrawalStep);
  readonly requestId$: Observable<string | null> = this.store.select(selectPublicWithdrawalRequestId);
  readonly resumed$: Observable<boolean> = this.store.select(selectPublicWithdrawalResumed);
  readonly addressee$: Observable<PublicWithdrawalAddressee | null> = this.store.select(
    selectPublicWithdrawalAddressee,
  );
  readonly addresseeLoading$: Observable<boolean> = this.store.select(selectPublicWithdrawalAddresseeLoading);
  readonly addresseeError$: Observable<string | null> = this.store.select(selectPublicWithdrawalAddresseeError);
  readonly loading$: Observable<boolean> = this.store.select(selectPublicWithdrawalLoading);
  readonly verifying$: Observable<boolean> = this.store.select(selectPublicWithdrawalVerifying);
  readonly confirming$: Observable<boolean> = this.store.select(selectPublicWithdrawalConfirming);
  readonly error$: Observable<string | null> = this.store.select(selectPublicWithdrawalError);
  readonly successMessage$: Observable<string | null> = this.store.select(selectPublicWithdrawalSuccessMessage);

  loadAddressee(): void {
    this.store.dispatch(loadPublicWithdrawalAddressee());
  }

  requestWithdrawal(dto: RequestPublicWithdrawalDto): void {
    this.store.dispatch(requestPublicWithdrawal({ dto }));
  }

  verifyCode(dto: VerifyPublicWithdrawalCodeDto): void {
    this.store.dispatch(verifyPublicWithdrawalCode({ dto }));
  }

  confirmWithdrawal(dto: ConfirmPublicWithdrawalDto): void {
    this.store.dispatch(confirmPublicWithdrawal({ dto }));
  }

  clearError(): void {
    this.store.dispatch(clearPublicWithdrawalError());
  }

  clearSuccessMessage(): void {
    this.store.dispatch(clearPublicWithdrawalSuccessMessage());
  }
}
