export class WithdrawalPolicyDto {
  periodDays!: number;
  allowedAfterProvisioning!: boolean;
  unprovisionedAlwaysWithdrawable!: true;
  provisionedRefundPolicy!: 'unused_period_prorated';
}

export class WithdrawalEligibilityDto {
  canWithdraw!: boolean;
  phase!: string;
  deadline?: Date;
  reason?: string;
  estimatedRefundGross?: number;
}

export class WithdrawalResultDto {
  refundNet?: number;
  refundGross?: number;
  creditNoteNumber?: string;
  paymentRefundStatus!: 'not_applicable' | 'pending' | 'succeeded' | 'failed';
}
