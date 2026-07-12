import {
  PromotionAdvantageType,
  type FixedAmountAdvantageConfig,
  type FreeBillingPeriodsAdvantageConfig,
  type FreeDaysAdvantageConfig,
} from '../constants/promotion.constants';

import {
  buildActivePromotionDisplay,
  buildAdvantageSummary,
  calculatePromotionOverlapDiscount,
  computeBenefitWindow,
  isPlanEligible,
  normalizePromotionCode,
  PROMOTION_VALIDATION_REDEEM_MAX_DRIFT_MS,
  resolveValidatedBenefitStart,
  roundMoney,
  validateAdvantageConfig,
} from './promotion-advantage.util';

describe('normalizePromotionCode', () => {
  it('trims and uppercases codes', () => {
    expect(normalizePromotionCode(' save10 ')).toBe('SAVE10');
  });
});

describe('isPlanEligible', () => {
  it('allows all plans when no restriction is configured', () => {
    expect(isPlanEligible({ applicablePlanIds: null } as never, 'plan-1')).toBe(true);
  });

  it('checks applicable plan ids', () => {
    expect(isPlanEligible({ applicablePlanIds: ['plan-1'] } as never, 'plan-1')).toBe(true);
    expect(isPlanEligible({ applicablePlanIds: ['plan-2'] } as never, 'plan-1')).toBe(false);
  });
});

describe('buildAdvantageSummary', () => {
  it('formats each advantage type', () => {
    expect(
      buildAdvantageSummary({
        advantageType: PromotionAdvantageType.FIXED_AMOUNT_NET,
        advantageConfig: { amountNet: 10 } satisfies FixedAmountAdvantageConfig,
      } as never),
    ).toBe('10.00 EUR credit');
    expect(
      buildAdvantageSummary({
        advantageType: PromotionAdvantageType.FREE_DAYS,
        advantageConfig: { days: 3 } satisfies FreeDaysAdvantageConfig,
      } as never),
    ).toBe('3 day(s) free');
    expect(
      buildAdvantageSummary({
        advantageType: PromotionAdvantageType.FREE_BILLING_PERIODS,
        advantageConfig: { periods: 2 } satisfies FreeBillingPeriodsAdvantageConfig,
      } as never),
    ).toBe('2 billing period(s) free');
  });
});

describe('computeBenefitWindow', () => {
  const now = new Date('2026-01-01T00:00:00Z');

  it('computes windows for each advantage type', () => {
    expect(
      computeBenefitWindow(
        {
          advantageType: PromotionAdvantageType.FIXED_AMOUNT_NET,
          advantageConfig: { amountNet: 15 },
        } as never,
        now,
      ),
    ).toEqual({ benefitStartsAt: now, remainingAmountNet: 15 });

    const freeDays = computeBenefitWindow(
      {
        advantageType: PromotionAdvantageType.FREE_DAYS,
        advantageConfig: { days: 2 },
      } as never,
      now,
    );
    expect(freeDays.benefitEndsAt?.toISOString()).toBe('2026-01-03T00:00:00.000Z');

    expect(
      computeBenefitWindow(
        {
          advantageType: PromotionAdvantageType.FREE_BILLING_PERIODS,
          advantageConfig: { periods: 1 },
        } as never,
        now,
      ),
    ).toEqual({ benefitStartsAt: now, remainingBillingPeriods: 1 });
  });
});

describe('validateAdvantageConfig', () => {
  it('accepts valid configs', () => {
    expect(() => validateAdvantageConfig(PromotionAdvantageType.FIXED_AMOUNT_NET, { amountNet: 10 })).not.toThrow();
    expect(() => validateAdvantageConfig(PromotionAdvantageType.FREE_DAYS, { days: 1 })).not.toThrow();
    expect(() => validateAdvantageConfig(PromotionAdvantageType.FREE_BILLING_PERIODS, { periods: 1 })).not.toThrow();
  });

  it('rejects invalid configs', () => {
    expect(() => validateAdvantageConfig(PromotionAdvantageType.FIXED_AMOUNT_NET, { amountNet: 0 })).toThrow(
      'Fixed amount must be greater than zero',
    );
    expect(() => validateAdvantageConfig(PromotionAdvantageType.FREE_DAYS, { days: 0 })).toThrow(
      'Free days must be a positive integer',
    );
    expect(() => validateAdvantageConfig('unknown' as PromotionAdvantageType, {} as never)).toThrow(
      'Unsupported advantage type',
    );
  });
});

describe('buildActivePromotionDisplay', () => {
  it('maps redemption display fields', () => {
    const display = buildActivePromotionDisplay({
      codeSnapshot: 'SAVE10',
      benefitStartsAt: new Date('2026-01-01T00:00:00Z'),
      benefitEndsAt: new Date('2026-02-01T00:00:00Z'),
      remainingAmountNet: '25.0000',
      remainingBillingPeriods: 2,
      promotion: {
        advantageType: PromotionAdvantageType.FIXED_AMOUNT_NET,
        advantageConfig: { amountNet: 25 },
      },
    } as never);

    expect(display.remainingMonetaryNet).toBe(25);
    expect(display.remainingPeriods).toBe(2);
    expect(display.advantageLabel).toContain('credit');
  });
});

describe('roundMoney', () => {
  it('rounds to two decimals', () => {
    expect(roundMoney(10.556)).toBe(10.56);
  });
});

describe('resolveValidatedBenefitStart', () => {
  it('returns validated start when within drift window', () => {
    const now = new Date('2026-01-01T12:00:00Z');
    const validated = new Date('2026-01-01T11:50:00Z');

    expect(resolveValidatedBenefitStart(validated.toISOString(), now).toISOString()).toBe(validated.toISOString());
  });

  it('falls back to now when validated start is stale', () => {
    const now = new Date('2026-01-01T12:00:00Z');
    const validated = new Date(now.getTime() - PROMOTION_VALIDATION_REDEEM_MAX_DRIFT_MS - 1_000);

    expect(resolveValidatedBenefitStart(validated.toISOString(), now)).toEqual(now);
  });
});

describe('calculatePromotionOverlapDiscount', () => {
  it('returns zero when charge period has no duration', () => {
    const date = new Date('2024-01-01T00:00:00Z');

    expect(calculatePromotionOverlapDiscount(100, date, date, date, new Date('2024-01-02T00:00:00Z'))).toBe(0);
  });

  it('prorates discount by overlap with the benefit window', () => {
    const chargeStart = new Date('2024-01-01T00:00:00Z');
    const chargeEnd = new Date('2024-01-31T00:00:00Z');
    const benefitStart = new Date('2024-01-01T00:00:00Z');
    const benefitEnd = new Date('2024-01-02T00:00:00Z');

    expect(calculatePromotionOverlapDiscount(126.39, chargeStart, chargeEnd, benefitStart, benefitEnd)).toBe(4.21);
  });
});
