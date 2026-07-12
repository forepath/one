import { IsBoolean, IsEnum, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, IsUUID, Min } from 'class-validator';

import {
  PromotionAdvantageType,
  PromotionRedemptionContext,
  PromotionRedemptionStatus,
  PromotionSubscriptionEligibility,
  type PromotionAdvantageConfig,
} from '../constants/promotion.constants';
import type { PromotionEntity } from '../entities/promotion.entity';

export class PromotionValidationResponseDto {
  valid!: boolean;
  message?: string;
  code?: string;
  promotionName?: string;
  subscriptionEligibility?: PromotionSubscriptionEligibility;
  advantageType?: PromotionAdvantageType;
  advantageSummary?: string;
  amountNet?: number;
  currency?: string;
  days?: number;
  periods?: number;
  benefitStartsAt?: string;
  benefitEndsAt?: string;
  chargePeriodStart?: string;
  chargePeriodEnd?: string;
  applicablePlanIds?: string[] | null;
}

export class ValidatePromotionDto {
  code!: string;
  redemptionContext!: PromotionRedemptionContext;
  subscriptionId?: string;
  planId?: string;
}

export class RedeemPromotionDto {
  code!: string;
  redemptionContext!: PromotionRedemptionContext;
  subscriptionId!: string;
  benefitStartsAt?: string;
}

export class PromotionRedemptionResponseDto {
  id!: string;
  code!: string;
  promotionName!: string;
  subscriptionId!: string;
  subscriptionNumber?: string;
  planName?: string;
  redemptionContext!: PromotionRedemptionContext;
  status!: PromotionRedemptionStatus;
  redeemedAt!: string;
  advantageType!: PromotionAdvantageType;
  advantageSummary!: string;
  validFrom!: string;
  validTo?: string;
  remainingMonetaryNet?: number;
  remainingPeriods?: number;
}

export class PaginatedPromotionRedemptionsResponseDto {
  items!: PromotionRedemptionResponseDto[];
  total!: number;
  limit!: number;
  offset!: number;
}

export class ApplicablePlanSummaryDto {
  id!: string;
  name!: string;
  serviceTypeName!: string;
}

export class AdminPromotionResponseDto {
  id!: string;
  code!: string;
  name!: string;
  description?: string;
  redeemableFrom!: string;
  redeemableTo!: string;
  maxTotalRedemptions?: number;
  maxPerUserRedemptions!: number;
  isActive!: boolean;
  advantageType!: PromotionAdvantageType;
  advantageConfig!: PromotionAdvantageConfig;
  applicablePlanIds?: string[] | null;
  applicablePlans!: ApplicablePlanSummaryDto[];
  subscriptionEligibility!: PromotionSubscriptionEligibility;
  redemptionCount!: number;
  createdAt!: string;
  updatedAt!: string;
}

export class PaginatedAdminPromotionsResponseDto {
  items!: AdminPromotionResponseDto[];
  total!: number;
  limit!: number;
  offset!: number;
}

export class CreateAdminPromotionDto {
  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsString()
  @IsNotEmpty()
  redeemableFrom!: string;

  @IsString()
  @IsNotEmpty()
  redeemableTo!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxTotalRedemptions?: number;

  @IsInt()
  @Min(1)
  maxPerUserRedemptions!: number;

  @IsBoolean()
  isActive!: boolean;

  @IsEnum(PromotionAdvantageType)
  advantageType!: PromotionAdvantageType;

  @IsObject()
  advantageConfig!: PromotionAdvantageConfig;

  @IsOptional()
  @IsUUID('4', { each: true })
  applicablePlanIds?: string[];

  @IsEnum(PromotionSubscriptionEligibility)
  subscriptionEligibility!: PromotionSubscriptionEligibility;
}

export class UpdateAdminPromotionDto extends CreateAdminPromotionDto {}

export class InvoicePromotionApplicationDraft {
  redemptionId!: string;
  amountAppliedNet!: number;
  periodsConsumed!: number;
  description!: string;
  taxCategory?: import('../constants/tax-category.constants').TaxCategory;
}
