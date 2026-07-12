export enum PromotionAdvantageType {
  FIXED_AMOUNT_NET = 'fixed_amount_net',
  FREE_DAYS = 'free_days',
  FREE_BILLING_PERIODS = 'free_billing_periods',
}

export enum PromotionSubscriptionEligibility {
  NEW = 'new',
  EXISTING = 'existing',
  BOTH = 'both',
}

export enum PromotionRedemptionContext {
  NEW = 'new',
  EXISTING = 'existing',
}

export enum PromotionRedemptionStatus {
  ACTIVE = 'active',
  EXHAUSTED = 'exhausted',
  EXPIRED = 'expired',
  CANCELLED = 'cancelled',
}

export interface FixedAmountAdvantageConfig {
  amountNet: number;
}

export interface FreeDaysAdvantageConfig {
  days: number;
}

export interface FreeBillingPeriodsAdvantageConfig {
  periods: number;
}

export type PromotionAdvantageConfig =
  | FixedAmountAdvantageConfig
  | FreeDaysAdvantageConfig
  | FreeBillingPeriodsAdvantageConfig;

export const PROMOTION_INVALID_CODE_MESSAGE = 'Invalid or expired promotion code';
