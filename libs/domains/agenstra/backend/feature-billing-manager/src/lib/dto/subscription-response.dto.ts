import { SubscriptionStatus } from '../entities/subscription.entity';

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
  createdAt!: Date;
  updatedAt!: Date;
}
