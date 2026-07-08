export type PublicWithdrawalResumeStep = 'code' | 'acknowledge';

export class PublicWithdrawalRequestResponseDto {
  requestId!: string;
  resumed!: boolean;
  resumeStep!: PublicWithdrawalResumeStep;
  message!: string;
}

export class PublicWithdrawalVerifyCodeResponseDto {
  resumeStep!: PublicWithdrawalResumeStep;
  message!: string;
}

export class PublicWithdrawalConfirmResponseDto {
  message!: string;
}

export class PublicWithdrawalAddresseeDto {
  name!: string;
  lines!: string[];
  vatId?: string;
  email?: string;
}
