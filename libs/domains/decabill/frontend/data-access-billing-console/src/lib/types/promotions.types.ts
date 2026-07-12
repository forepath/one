import type { ListParams } from './billing.types';

export type PromotionAdvantageType = 'fixed_amount_net' | 'free_days' | 'free_billing_periods';
export type PromotionRedemptionContext = 'new' | 'existing';
export type PromotionRedemptionStatus = 'active' | 'exhausted' | 'expired' | 'cancelled';
export type PromotionSubscriptionEligibility = 'new' | 'existing' | 'both';

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface PromotionValidationResponse {
  valid: boolean;
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

export interface ValidatePromotionRequest {
  code: string;
  redemptionContext: PromotionRedemptionContext;
  subscriptionId?: string;
  planId?: string;
}

export interface RedeemPromotionRequest {
  code: string;
  redemptionContext: PromotionRedemptionContext;
  subscriptionId: string;
  benefitStartsAt?: string;
}

export interface PromotionRedemptionResponse {
  id: string;
  code: string;
  promotionName: string;
  subscriptionId: string;
  subscriptionNumber?: string;
  planName?: string;
  redemptionContext: PromotionRedemptionContext;
  status: PromotionRedemptionStatus;
  redeemedAt: string;
  advantageType: PromotionAdvantageType;
  advantageSummary: string;
  validFrom: string;
  validTo?: string;
  remainingMonetaryNet?: number;
  remainingPeriods?: number;
}

export interface ApplicablePlanSummary {
  id: string;
  name: string;
  serviceTypeName: string;
}

export interface AdminPromotionResponse {
  id: string;
  code: string;
  name: string;
  description?: string;
  redeemableFrom: string;
  redeemableTo: string;
  maxTotalRedemptions?: number;
  maxPerUserRedemptions: number;
  isActive: boolean;
  advantageType: PromotionAdvantageType;
  advantageConfig: Record<string, unknown>;
  applicablePlanIds?: string[] | null;
  applicablePlans: ApplicablePlanSummary[];
  subscriptionEligibility: PromotionSubscriptionEligibility;
  redemptionCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAdminPromotionDto {
  code: string;
  name: string;
  description?: string;
  redeemableFrom: string;
  redeemableTo: string;
  maxTotalRedemptions?: number;
  maxPerUserRedemptions: number;
  isActive: boolean;
  advantageType: PromotionAdvantageType;
  advantageConfig: Record<string, unknown>;
  applicablePlanIds?: string[];
  subscriptionEligibility: PromotionSubscriptionEligibility;
}

export type UpdateAdminPromotionDto = CreateAdminPromotionDto;

export type PaginatedPromotionRedemptionsResponse = PaginatedResponse<PromotionRedemptionResponse>;
export type PaginatedAdminPromotionsResponse = PaginatedResponse<AdminPromotionResponse>;

export type { ListParams };
