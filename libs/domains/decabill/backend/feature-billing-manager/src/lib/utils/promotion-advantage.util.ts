import {
  PromotionAdvantageType,
  type FixedAmountAdvantageConfig,
  type FreeBillingPeriodsAdvantageConfig,
  type FreeDaysAdvantageConfig,
  type PromotionAdvantageConfig,
} from '../constants/promotion.constants';
import type { PromotionEntity } from '../entities/promotion.entity';
import type { PromotionRedemptionEntity } from '../entities/promotion-redemption.entity';

export function normalizePromotionCode(code: string): string {
  return code.trim().toUpperCase();
}

/** Maximum time between validate preview and redeem that preserves the validated benefit start. */
export const PROMOTION_VALIDATION_REDEEM_MAX_DRIFT_MS = 30 * 60 * 1000;

export function resolveValidatedBenefitStart(validatedBenefitStartsAt?: string, now: Date = new Date()): Date {
  if (!validatedBenefitStartsAt) {
    return now;
  }

  const parsed = new Date(validatedBenefitStartsAt);

  if (Number.isNaN(parsed.getTime())) {
    return now;
  }

  const driftMs = Math.abs(now.getTime() - parsed.getTime());

  if (driftMs > PROMOTION_VALIDATION_REDEEM_MAX_DRIFT_MS) {
    return now;
  }

  return parsed;
}

export function isPlanEligible(promotion: PromotionEntity, planId: string): boolean {
  const applicable = promotion.applicablePlanIds;

  if (!applicable || applicable.length === 0) {
    return true;
  }

  return applicable.includes(planId);
}

export function buildAdvantageSummary(promotion: PromotionEntity, currency = 'EUR'): string {
  const config = promotion.advantageConfig;

  switch (promotion.advantageType) {
    case PromotionAdvantageType.FIXED_AMOUNT_NET: {
      const amount = (config as FixedAmountAdvantageConfig).amountNet;

      return `${amount.toFixed(2)} ${currency} credit`;
    }
    case PromotionAdvantageType.FREE_DAYS: {
      const days = (config as FreeDaysAdvantageConfig).days;

      return `${days} day(s) free`;
    }
    case PromotionAdvantageType.FREE_BILLING_PERIODS: {
      const periods = (config as FreeBillingPeriodsAdvantageConfig).periods;

      return `${periods} billing period(s) free`;
    }
    default:
      return 'Promotion benefit';
  }
}

export function computeBenefitWindow(
  promotion: PromotionEntity,
  now: Date = new Date(),
): { benefitStartsAt: Date; benefitEndsAt?: Date; remainingAmountNet?: number; remainingBillingPeriods?: number } {
  switch (promotion.advantageType) {
    case PromotionAdvantageType.FIXED_AMOUNT_NET: {
      const amount = (promotion.advantageConfig as FixedAmountAdvantageConfig).amountNet;

      return { benefitStartsAt: now, remainingAmountNet: amount };
    }
    case PromotionAdvantageType.FREE_DAYS: {
      const days = (promotion.advantageConfig as FreeDaysAdvantageConfig).days;
      const benefitEndsAt = new Date(now);

      benefitEndsAt.setDate(benefitEndsAt.getDate() + days);

      return { benefitStartsAt: now, benefitEndsAt };
    }
    case PromotionAdvantageType.FREE_BILLING_PERIODS: {
      const periods = (promotion.advantageConfig as FreeBillingPeriodsAdvantageConfig).periods;

      return { benefitStartsAt: now, remainingBillingPeriods: periods };
    }
    default:
      return { benefitStartsAt: now };
  }
}

export function validateAdvantageConfig(type: PromotionAdvantageType, config: PromotionAdvantageConfig): void {
  switch (type) {
    case PromotionAdvantageType.FIXED_AMOUNT_NET: {
      const amount = (config as FixedAmountAdvantageConfig).amountNet;

      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error('Fixed amount must be greater than zero');
      }

      return;
    }
    case PromotionAdvantageType.FREE_DAYS: {
      const days = (config as FreeDaysAdvantageConfig).days;

      if (!Number.isInteger(days) || days <= 0) {
        throw new Error('Free days must be a positive integer');
      }

      return;
    }
    case PromotionAdvantageType.FREE_BILLING_PERIODS: {
      const periods = (config as FreeBillingPeriodsAdvantageConfig).periods;

      if (!Number.isInteger(periods) || periods <= 0) {
        throw new Error('Free billing periods must be a positive integer');
      }

      return;
    }
    default:
      throw new Error('Unsupported advantage type');
  }
}

export function buildActivePromotionDisplay(redemption: PromotionRedemptionEntity, currency = 'EUR') {
  const promotion = redemption.promotion;

  return {
    validFrom: redemption.benefitStartsAt,
    validTo: redemption.benefitEndsAt,
    remainingMonetaryNet: redemption.remainingAmountNet != null ? Number(redemption.remainingAmountNet) : undefined,
    remainingPeriods: redemption.remainingBillingPeriods ?? undefined,
    advantageLabel: promotion ? buildAdvantageSummary(promotion, currency) : redemption.codeSnapshot,
  };
}

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function calculatePromotionOverlapDiscount(
  chargeNet: number,
  chargePeriodStart: Date,
  chargePeriodEnd: Date,
  benefitStart: Date,
  benefitEnd: Date,
): number {
  const periodMs = chargePeriodEnd.getTime() - chargePeriodStart.getTime();

  if (periodMs <= 0 || chargeNet <= 0) {
    return 0;
  }

  const overlapStart = Math.max(chargePeriodStart.getTime(), benefitStart.getTime());
  const overlapEnd = Math.min(chargePeriodEnd.getTime(), benefitEnd.getTime());
  const overlapMs = Math.max(0, overlapEnd - overlapStart);

  return roundMoney(chargeNet * (overlapMs / periodMs));
}
