import { SubscriptionStatus } from '../entities/subscription.entity';

import { SubscriptionMeterSummaryDto } from './meter-response.dto';
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
  instantRemoval?: boolean;
  instantCanceledAt?: Date;
  withdrawalEligibility?: WithdrawalEligibilityDto;
  withdrawalResult?: WithdrawalResultDto;
  periodTotalPrice?: number;
  meters!: SubscriptionMeterSummaryDto[];
  createdAt!: Date;
  updatedAt!: Date;
}
