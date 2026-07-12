import type {
  PricingPreviewResponse,
  PromotionValidationResponse,
} from '@forepath/decabill/frontend/data-access-billing-console';

import {
  buildPromotionAdjustedOrderPricing,
  buildPromotionPeriodPricingPreview,
  buildPromotionPricingPreviewOptions,
} from './promotion-pricing-preview.util';

describe('buildPromotionPeriodPricingPreview', () => {
  const basePreview: PromotionValidationResponse = {
    valid: true,
    code: 'SAVE10',
    promotionName: 'Save 10',
    advantageSummary: '10 EUR credit',
  };

  it('returns null when preview is invalid', () => {
    expect(buildPromotionPeriodPricingPreview({ valid: false, message: 'Invalid' }, 25)).toBeNull();
  });

  it('computes free billing period pricing', () => {
    const result = buildPromotionPeriodPricingPreview(
      { ...basePreview, advantageType: 'free_billing_periods', periods: 2 },
      49.99,
    );

    expect(result).toEqual(
      expect.objectContaining({
        regularPeriodPriceNet: 49.99,
        duringBenefitPeriodPriceNet: 0,
        afterBenefitPeriodPriceNet: 49.99,
        showAfterBenefit: true,
      }),
    );
  });

  it('computes fixed amount credit for a single period', () => {
    const result = buildPromotionPeriodPricingPreview(
      { ...basePreview, advantageType: 'fixed_amount_net', amountNet: 10, currency: 'EUR' },
      25,
    );

    expect(result).toEqual(
      expect.objectContaining({
        duringBenefitPeriodPriceNet: 15,
        afterBenefitPeriodPriceNet: 25,
        showAfterBenefit: true,
      }),
    );
  });

  it('computes fixed amount credit spanning multiple periods', () => {
    const result = buildPromotionPeriodPricingPreview(
      { ...basePreview, advantageType: 'fixed_amount_net', amountNet: 60, currency: 'EUR' },
      25,
    );

    expect(result).toEqual(
      expect.objectContaining({
        duringBenefitPeriodPriceNet: 0,
        afterBenefitPeriodPriceNet: 25,
        showAfterBenefit: true,
      }),
    );
  });

  it('prorates free days against the billing period length', () => {
    const periodStart = new Date('2024-01-01T00:00:00Z');
    const benefitEndsAt = new Date('2024-01-02T00:00:00Z').toISOString();
    const result = buildPromotionPeriodPricingPreview(
      {
        ...basePreview,
        advantageType: 'free_days',
        days: 1,
        benefitStartsAt: periodStart.toISOString(),
        benefitEndsAt,
      },
      126.39,
      {
        billing: {
          billingIntervalType: 'day',
          billingIntervalValue: 30,
        },
        periodStart,
      },
    );

    expect(result).toEqual(
      expect.objectContaining({
        regularPeriodPriceNet: 126.39,
        discountNet: 4.21,
        duringBenefitPeriodPriceNet: 122.18,
        afterBenefitPeriodPriceNet: 126.39,
        showAfterBenefit: true,
      }),
    );
  });

  it('uses backend charge period end when provided', () => {
    const periodStart = new Date('2024-01-01T00:00:00Z');
    const periodEnd = new Date('2024-01-15T00:00:00Z');
    const result = buildPromotionPeriodPricingPreview(
      {
        ...basePreview,
        advantageType: 'free_days',
        days: 1,
        benefitStartsAt: periodStart.toISOString(),
        benefitEndsAt: new Date('2024-01-02T00:00:00Z').toISOString(),
        chargePeriodStart: periodStart.toISOString(),
        chargePeriodEnd: periodEnd.toISOString(),
      },
      126.39,
      {
        billing: { billingIntervalType: 'day', billingIntervalValue: 30 },
        periodStart,
        periodEnd,
      },
    );

    expect(result?.discountNet).toBeGreaterThan(0);
    expect(result?.duringBenefitPeriodPriceNet).toBeLessThan(126.39);
  });

  it('returns null for unsupported advantage types', () => {
    expect(
      buildPromotionPeriodPricingPreview({ ...basePreview, valid: true, advantageType: 'unknown' as never }, 25),
    ).toBeNull();
  });
});

describe('buildPromotionPricingPreviewOptions', () => {
  it('prefers charge period start over benefit start', () => {
    const options = buildPromotionPricingPreviewOptions(
      {
        valid: true,
        benefitStartsAt: '2024-01-01T00:00:00.000Z',
        chargePeriodStart: '2024-01-10T00:00:00.000Z',
        chargePeriodEnd: '2024-02-01T00:00:00.000Z',
      },
      { billingIntervalType: 'day', billingIntervalValue: 30 },
      'Jan 31',
    );

    expect(options.periodStart?.toISOString()).toBe('2024-01-10T00:00:00.000Z');
    expect(options.periodEnd?.toISOString()).toBe('2024-02-01T00:00:00.000Z');
    expect(options.benefitEndsLabel).toBe('Jan 31');
  });
});

describe('buildPromotionAdjustedOrderPricing', () => {
  const basePreview: PromotionValidationResponse = {
    valid: true,
    code: 'SAVE10',
    promotionName: 'Save 10',
    advantageSummary: '10 EUR credit',
    advantageType: 'fixed_amount_net',
    amountNet: 10,
    currency: 'EUR',
  };

  const pricing: PricingPreviewResponse = {
    basePrice: 20,
    marginPercent: 0,
    marginFixed: 0,
    totalPrice: 25,
    taxTotal: 4.75,
    totalGross: 29.75,
    taxRate: 19,
  };

  it('applies promotion discount to order pricing preview', () => {
    const result = buildPromotionAdjustedOrderPricing(basePreview, pricing);

    expect(result).toEqual(
      expect.objectContaining({
        promotionLabel: '10 EUR credit',
        duringBenefit: expect.objectContaining({
          discountNet: 10,
          subtotalNet: 15,
          taxTotal: 2.85,
          totalGross: 17.85,
        }),
        afterBenefit: expect.objectContaining({
          subtotalNet: 25,
          taxTotal: 4.75,
          totalGross: 29.75,
        }),
      }),
    );
  });

  it('prorates free-day promotion discount in order pricing preview', () => {
    const periodStart = new Date('2024-01-01T00:00:00Z');
    const result = buildPromotionAdjustedOrderPricing(
      {
        valid: true,
        code: 'FREEDAY',
        promotionName: 'One free day',
        advantageSummary: '1 day(s) free',
        advantageType: 'free_days',
        days: 1,
        benefitStartsAt: periodStart.toISOString(),
        benefitEndsAt: new Date('2024-01-02T00:00:00Z').toISOString(),
      },
      {
        basePrice: 100,
        marginPercent: 0,
        marginFixed: 0,
        totalPrice: 126.39,
        taxTotal: 24.01,
        totalGross: 150.4,
        taxRate: 19,
      },
      {
        billing: {
          billingIntervalType: 'day',
          billingIntervalValue: 30,
        },
        periodStart,
      },
    );

    expect(result?.duringBenefit.discountNet).toBe(4.21);
    expect(result?.duringBenefit.subtotalNet).toBe(122.18);
  });
});
