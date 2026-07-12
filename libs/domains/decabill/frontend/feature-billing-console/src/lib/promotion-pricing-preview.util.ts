import type {
  PricingPreviewResponse,
  PromotionValidationResponse,
} from '@forepath/decabill/frontend/data-access-billing-console';

import { calculateProratedDiscount, getBillingPeriodEnd, type PromotionBillingContext } from './billing-period.util';

export interface PromotionPeriodPricingPreview {
  regularPeriodPriceNet: number;
  duringBenefitPeriodPriceNet: number;
  afterBenefitPeriodPriceNet: number;
  discountNet: number;
  duringBenefitLabel: string;
  afterBenefitLabel: string;
  showAfterBenefit: boolean;
  benefitEndsAt?: string;
}

export interface PromotionAdjustedPricingAmounts {
  subtotalNet: number;
  taxTotal: number;
  totalGross: number;
  discountNet: number;
}

export interface PromotionAdjustedOrderPricing {
  duringBenefit: PromotionAdjustedPricingAmounts & { label: string };
  afterBenefit: PromotionAdjustedPricingAmounts & { label: string };
  showAfterBenefit: boolean;
  promotionLabel: string;
  taxRate: number;
}

export interface PromotionPricingPreviewOptions {
  benefitEndsLabel?: string;
  billing?: PromotionBillingContext;
  periodStart?: Date;
  periodEnd?: Date;
}

export function buildPromotionPricingPreviewOptions(
  preview: PromotionValidationResponse,
  billing?: PromotionBillingContext | null,
  benefitEndsLabel?: string,
): PromotionPricingPreviewOptions {
  return {
    benefitEndsLabel,
    billing: billing ?? undefined,
    periodStart: preview.chargePeriodStart
      ? new Date(preview.chargePeriodStart)
      : preview.benefitStartsAt
        ? new Date(preview.benefitStartsAt)
        : undefined,
    periodEnd: preview.chargePeriodEnd ? new Date(preview.chargePeriodEnd) : undefined,
  };
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function scalePricingAmounts(
  pricing: PricingPreviewResponse,
  adjustedSubtotalNet: number,
): PromotionAdjustedPricingAmounts {
  const discountNet = roundMoney(Math.max(0, pricing.totalPrice - adjustedSubtotalNet));
  const ratio = pricing.totalPrice > 0 ? adjustedSubtotalNet / pricing.totalPrice : 0;
  const subtotalNet = roundMoney(adjustedSubtotalNet);
  const taxTotal = roundMoney(pricing.taxTotal * ratio);
  const totalGross = roundMoney(subtotalNet + taxTotal);

  return { subtotalNet, taxTotal, totalGross, discountNet };
}

function resolveBenefitWindow(
  preview: PromotionValidationResponse,
  periodStart: Date,
): { benefitStart: Date; benefitEnd: Date } {
  const benefitStart = preview.benefitStartsAt ? new Date(preview.benefitStartsAt) : periodStart;
  const benefitEnd = preview.benefitEndsAt
    ? new Date(preview.benefitEndsAt)
    : (() => {
        const end = new Date(benefitStart);

        end.setDate(end.getDate() + (preview.days ?? 0));

        return end;
      })();

  return { benefitStart, benefitEnd };
}

function buildFreeDaysPreview(
  preview: PromotionValidationResponse,
  regular: number,
  options?: PromotionPricingPreviewOptions,
): PromotionPeriodPricingPreview {
  const periodStart =
    options?.periodStart ?? (preview.benefitStartsAt ? new Date(preview.benefitStartsAt) : new Date());
  const { benefitStart, benefitEnd } = resolveBenefitWindow(preview, periodStart);
  const benefitEndsLabel = options?.benefitEndsLabel;

  let discountNet = regular;
  let duringBenefitPeriodPriceNet = 0;

  if (options?.billing) {
    const periodEnd = options.periodEnd ?? getBillingPeriodEnd(options.billing, periodStart);

    discountNet = calculateProratedDiscount(regular, periodStart, periodEnd, benefitStart, benefitEnd);
    duringBenefitPeriodPriceNet = roundMoney(Math.max(0, regular - discountNet));
  } else if (preview.days != null && preview.days > 0) {
    const freeDays = preview.days;

    discountNet = roundMoney(Math.min(regular, regular * (freeDays / 30)));
    duringBenefitPeriodPriceNet = roundMoney(Math.max(0, regular - discountNet));
  }

  const duringLabel = benefitEndsLabel
    ? $localize`:@@featurePromotions-duringFreeDaysUntil:Until ${benefitEndsLabel}:date:`
    : $localize`:@@featurePromotions-duringNextPeriod:Next billing period`;

  return {
    regularPeriodPriceNet: regular,
    duringBenefitPeriodPriceNet,
    afterBenefitPeriodPriceNet: regular,
    discountNet,
    duringBenefitLabel: duringLabel,
    afterBenefitLabel: benefitEndsLabel
      ? $localize`:@@featurePromotions-afterFreeDaysEnds:After ${benefitEndsLabel}:date:`
      : $localize`:@@featurePromotions-afterFreeDays:After free period ends`,
    showAfterBenefit: discountNet < regular,
    benefitEndsAt: preview.benefitEndsAt,
  };
}

export function buildPromotionAdjustedOrderPricing(
  preview: PromotionValidationResponse,
  pricing: PricingPreviewResponse,
  options?: PromotionPricingPreviewOptions,
): PromotionAdjustedOrderPricing | null {
  const periodPricing = buildPromotionPeriodPricingPreview(preview, pricing.totalPrice, options);

  if (!periodPricing) {
    return null;
  }

  const duringBenefit = scalePricingAmounts(pricing, periodPricing.duringBenefitPeriodPriceNet);
  const afterBenefit = scalePricingAmounts(pricing, periodPricing.afterBenefitPeriodPriceNet);

  return {
    duringBenefit: {
      ...duringBenefit,
      discountNet: periodPricing.discountNet,
      label: periodPricing.duringBenefitLabel,
    },
    afterBenefit: { ...afterBenefit, label: periodPricing.afterBenefitLabel },
    showAfterBenefit: periodPricing.showAfterBenefit,
    promotionLabel: preview.advantageSummary ?? preview.code ?? preview.promotionName ?? 'Promotion',
    taxRate: pricing.taxRate,
  };
}

export function buildPromotionPeriodPricingPreview(
  preview: PromotionValidationResponse,
  periodTotalPrice: number,
  options?: PromotionPricingPreviewOptions,
): PromotionPeriodPricingPreview | null {
  if (!preview.valid || !Number.isFinite(periodTotalPrice) || periodTotalPrice <= 0) {
    return null;
  }

  const regular = periodTotalPrice;

  switch (preview.advantageType) {
    case 'free_billing_periods': {
      const periods = preview.periods ?? 0;

      return {
        regularPeriodPriceNet: regular,
        duringBenefitPeriodPriceNet: 0,
        afterBenefitPeriodPriceNet: regular,
        discountNet: regular,
        duringBenefitLabel:
          periods === 1
            ? $localize`:@@featurePromotions-duringNextPeriod:Next billing period`
            : $localize`:@@featurePromotions-duringNextPeriods:Next ${periods} billing periods`,
        afterBenefitLabel:
          periods === 1
            ? $localize`:@@featurePromotions-afterFreePeriod:Following periods`
            : $localize`:@@featurePromotions-afterFreePeriods:After ${periods} free periods`,
        showAfterBenefit: true,
        benefitEndsAt: preview.benefitEndsAt,
      };
    }
    case 'free_days':
      return buildFreeDaysPreview(preview, regular, options);
    case 'fixed_amount_net': {
      const credit = preview.amountNet ?? 0;
      const discountNet = roundMoney(Math.min(credit, regular));
      const firstPeriodPrice = roundMoney(Math.max(0, regular - discountNet));
      const spansMultiplePeriods = credit > regular;

      return {
        regularPeriodPriceNet: regular,
        duringBenefitPeriodPriceNet: firstPeriodPrice,
        afterBenefitPeriodPriceNet: regular,
        discountNet,
        duringBenefitLabel: spansMultiplePeriods
          ? $localize`:@@featurePromotions-duringCreditRemaining:While credit remains`
          : $localize`:@@featurePromotions-duringNextPeriod:Next billing period`,
        afterBenefitLabel: $localize`:@@featurePromotions-afterCreditUsed:After credit is used`,
        showAfterBenefit: credit > 0 && (firstPeriodPrice < regular || spansMultiplePeriods),
        benefitEndsAt: preview.benefitEndsAt,
      };
    }
    default:
      return null;
  }
}
