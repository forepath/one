import { PromotionAdvantageType, PromotionRedemptionStatus } from '../constants/promotion.constants';
import { TaxCategory } from '../constants/tax-category.constants';

import { PromotionApplicationService } from './promotion-application.service';

describe('PromotionApplicationService', () => {
  const promotionRedemptionsRepository = {
    findActiveBySubscription: jest.fn(),
    findByIdOrThrow: jest.fn(),
    update: jest.fn(),
  };
  const invoicePromotionApplicationsRepository = {
    findByInvoiceId: jest.fn(),
  };

  const service = new PromotionApplicationService(
    promotionRedemptionsRepository as never,
    invoicePromotionApplicationsRepository as never,
  );

  beforeEach(() => {
    jest.resetAllMocks();
  });

  function buildRedemption(overrides: Record<string, unknown> = {}) {
    return {
      id: 'red-1',
      codeSnapshot: 'PROMO10',
      remainingBillingPeriods: 1,
      remainingAmountNet: null,
      benefitStartsAt: new Date('2026-01-01T00:00:00Z'),
      benefitEndsAt: new Date('2026-01-31T00:00:00Z'),
      status: PromotionRedemptionStatus.ACTIVE,
      subscription: { planId: 'plan-1' },
      promotion: {
        isActive: true,
        advantageType: PromotionAdvantageType.FREE_DAYS,
        advantageConfig: { days: 30 },
        applicablePlanIds: ['plan-1'],
      },
      ...overrides,
    };
  }

  it('skips inactive promotions and ineligible plans', async () => {
    promotionRedemptionsRepository.findActiveBySubscription.mockResolvedValue([
      buildRedemption({ promotion: { isActive: false, advantageType: PromotionAdvantageType.FIXED_AMOUNT_NET } }),
      buildRedemption({ subscription: { planId: 'other-plan' } }),
    ]);

    const result = await service.calculatePromotions({
      userId: 'user-1',
      subscriptionId: 'sub-1',
      chargeLines: [{ description: 'Charge', quantity: 1, unitPriceNet: 100, taxCategory: TaxCategory.STANDARD }],
      defaultTaxCategory: TaxCategory.STANDARD,
    });

    expect(result.discountLines).toHaveLength(0);
    expect(result.adjustedSubtotalNet).toBe(100);
  });

  it('applies prorated free-days discount for overlapping charge period', async () => {
    promotionRedemptionsRepository.findActiveBySubscription.mockResolvedValue([buildRedemption()]);

    const result = await service.calculatePromotions({
      userId: 'user-1',
      subscriptionId: 'sub-1',
      chargeLines: [{ description: 'Charge', quantity: 1, unitPriceNet: 100, taxCategory: TaxCategory.STANDARD }],
      defaultTaxCategory: TaxCategory.STANDARD,
      chargePeriod: {
        start: new Date('2026-01-01T00:00:00Z'),
        end: new Date('2026-02-01T00:00:00Z'),
      },
      subscriptionChargeNet: 90,
    });

    expect(result.discountLines).toHaveLength(1);
    expect(result.discountLines[0].unitPriceNet).toBeLessThan(0);
    expect(result.adjustedSubtotalNet).toBeLessThan(100);
  });

  it('waives only subscription base for free billing periods when usage is included', async () => {
    promotionRedemptionsRepository.findActiveBySubscription.mockResolvedValue([
      buildRedemption({
        remainingBillingPeriods: 2,
        promotion: {
          isActive: true,
          advantageType: PromotionAdvantageType.FREE_BILLING_PERIODS,
          applicablePlanIds: ['plan-1'],
        },
      }),
    ]);

    const result = await service.calculatePromotions({
      userId: 'user-1',
      subscriptionId: 'sub-1',
      chargeLines: [{ description: 'Charge', quantity: 1, unitPriceNet: 120, taxCategory: TaxCategory.STANDARD }],
      defaultTaxCategory: TaxCategory.STANDARD,
      subscriptionChargeNet: 90,
    });

    expect(result.applications[0].amountAppliedNet).toBe(90);
    expect(result.adjustedSubtotalNet).toBe(30);
    expect(result.redemptionUpdates[0]).toEqual(
      expect.objectContaining({ remainingBillingPeriods: 1, status: PromotionRedemptionStatus.ACTIVE }),
    );
  });

  it('applies fixed amount credit redemption', async () => {
    promotionRedemptionsRepository.findActiveBySubscription.mockResolvedValue([
      buildRedemption({
        remainingAmountNet: 25,
        promotion: {
          isActive: true,
          advantageType: PromotionAdvantageType.FIXED_AMOUNT_NET,
          applicablePlanIds: ['plan-1'],
          advantageConfig: { amountNet: 25 },
        },
      }),
    ]);

    const result = await service.calculatePromotions({
      userId: 'user-1',
      subscriptionId: 'sub-1',
      chargeLines: [{ description: 'Charge', quantity: 1, unitPriceNet: 40, taxCategory: TaxCategory.STANDARD }],
      defaultTaxCategory: TaxCategory.STANDARD,
    });

    expect(result.applications[0].amountAppliedNet).toBe(25);
    expect(result.adjustedSubtotalNet).toBe(15);
    expect(result.redemptionUpdates[0]).toEqual(
      expect.objectContaining({ remainingAmountNet: 0, status: PromotionRedemptionStatus.EXHAUSTED }),
    );
  });

  it('captures rollback snapshots and restores previous redemption state', async () => {
    promotionRedemptionsRepository.findByIdOrThrow.mockResolvedValue({
      id: 'red-1',
      remainingBillingPeriods: 2,
      remainingAmountNet: 50,
      status: PromotionRedemptionStatus.ACTIVE,
    });

    const rollbacks = await service.commitRedemptionUpdatesWithRollback([
      { redemptionId: 'red-1', remainingBillingPeriods: 1, status: PromotionRedemptionStatus.ACTIVE },
    ]);

    expect(rollbacks).toEqual([
      {
        redemptionId: 'red-1',
        previousRemainingBillingPeriods: 2,
        previousRemainingAmountNet: 50,
        previousStatus: PromotionRedemptionStatus.ACTIVE,
      },
    ]);

    await service.rollbackRedemptionUpdates(rollbacks);

    expect(promotionRedemptionsRepository.update).toHaveBeenLastCalledWith('red-1', {
      remainingBillingPeriods: 2,
      remainingAmountNet: 50,
      status: PromotionRedemptionStatus.ACTIVE,
    });
  });

  it('reverts promotion balances when invoice is voided', async () => {
    invoicePromotionApplicationsRepository.findByInvoiceId.mockResolvedValue([
      {
        amountAppliedNet: 25,
        periodsConsumed: 1,
        redemption: {
          id: 'red-1',
          remainingBillingPeriods: 0,
          remainingAmountNet: 0,
          status: PromotionRedemptionStatus.EXHAUSTED,
        },
      },
    ]);

    await service.revertPromotionApplicationsForInvoice('inv-1');

    expect(promotionRedemptionsRepository.update).toHaveBeenCalledWith(
      'red-1',
      expect.objectContaining({
        remainingBillingPeriods: 1,
        remainingAmountNet: 25,
        status: PromotionRedemptionStatus.ACTIVE,
      }),
    );
  });
});
