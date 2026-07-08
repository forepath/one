import { SubscriptionStatus } from '../entities/subscription.entity';

import { WithdrawalEligibilityDto, WithdrawalResultDto } from './withdrawal-policy.dto';

export class SubscriptionResponseDto {
  id!: string;
  number!: string;
  planId!: string;
  userId!: string;
  status!: SubscriptionStatus;
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
  nextBillingAt?: Date;
  cancelRequestedAt?: Date;
  cancelEffectiveAt?: Date;
  resumedAt?: Date;
  withdrawnAt?: Date;
  withdrawalEligibility?: WithdrawalEligibilityDto;
  withdrawalResult?: WithdrawalResultDto;
  periodTotalPrice?: number;
  createdAt!: Date;
  updatedAt!: Date;
}
