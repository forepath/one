export type PublicWithdrawalStep = 'details' | 'code' | 'acknowledge' | 'done';
export type PublicWithdrawalResumeStep = 'code' | 'acknowledge';

export interface PublicWithdrawalAddressee {
  name: string;
  lines: string[];
  vatId?: string;
  email?: string;
}

export interface RequestPublicWithdrawalDto {
  subscriptionNumber: string;
  customerName: string;
  email: string;
  company?: string;
  orderedOn: string;
  receivedOn?: string;
}

export interface PublicWithdrawalRequestResponse {
  requestId: string;
  resumed: boolean;
  resumeStep: PublicWithdrawalResumeStep;
  message: string;
}

export interface VerifyPublicWithdrawalCodeDto {
  requestId: string;
  code: string;
}

export interface PublicWithdrawalVerifyCodeResponse {
  resumeStep: PublicWithdrawalResumeStep;
  message: string;
}

export interface ConfirmPublicWithdrawalDto {
  requestId: string;
  acknowledgeWithdrawal: true;
}

export interface PublicWithdrawalConfirmResponse {
  message: string;
}
