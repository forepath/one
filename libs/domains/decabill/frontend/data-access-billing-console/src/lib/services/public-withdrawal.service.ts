import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Environment } from '@forepath/shared/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';
import { Observable } from 'rxjs';

import type {
  ConfirmPublicWithdrawalDto,
  PublicWithdrawalAddressee,
  PublicWithdrawalConfirmResponse,
  PublicWithdrawalRequestResponse,
  PublicWithdrawalVerifyCodeResponse,
  RequestPublicWithdrawalDto,
  VerifyPublicWithdrawalCodeDto,
} from '../types/public-withdrawal.types';

@Injectable({
  providedIn: 'root',
})
export class PublicWithdrawalService {
  private readonly http = inject(HttpClient);
  private readonly environment = inject<Environment>(ENVIRONMENT);

  private get apiUrl(): string {
    return this.environment.billing.restApiUrl;
  }

  getAddressee(): Observable<PublicWithdrawalAddressee> {
    return this.http.get<PublicWithdrawalAddressee>(`${this.apiUrl}/public/withdrawal/addressee`);
  }

  requestWithdrawal(dto: RequestPublicWithdrawalDto): Observable<PublicWithdrawalRequestResponse> {
    return this.http.post<PublicWithdrawalRequestResponse>(`${this.apiUrl}/public/withdrawal/request`, dto);
  }

  verifyCode(dto: VerifyPublicWithdrawalCodeDto): Observable<PublicWithdrawalVerifyCodeResponse> {
    return this.http.post<PublicWithdrawalVerifyCodeResponse>(`${this.apiUrl}/public/withdrawal/verify-code`, dto);
  }

  confirmWithdrawal(dto: ConfirmPublicWithdrawalDto): Observable<PublicWithdrawalConfirmResponse> {
    return this.http.post<PublicWithdrawalConfirmResponse>(`${this.apiUrl}/public/withdrawal/confirm`, dto);
  }
}
