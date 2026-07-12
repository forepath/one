import { BadRequestException } from '@nestjs/common';

import {
  PROMOTION_INVALID_CODE_MESSAGE,
  PromotionAdvantageType,
  PromotionRedemptionContext,
  PromotionRedemptionStatus,
} from '../constants/promotion.constants';

import { PromotionRedemptionService } from './promotion-redemption.service';

describe('PromotionRedemptionService', () => {
  const dataSource = {
    transaction: jest.fn(async (callback: (manager: { id: string }) => Promise<unknown>) =>
      callback({ id: 'tx-manager' }),
    ),
  };
  const promotionValidationService = {
    validatePromotion: jest.fn(),
    resolvePromotion: jest.fn(),
  };
  const promotionsRepository = {
    findByIdForUpdate: jest.fn(),
  };
  const promotionRedemptionsRepository = {
    create: jest.fn(),
    findByIdOrThrow: jest.fn(),
    hasActiveRedemptionForSubscription: jest.fn(),
    findActiveByUser: jest.fn(),
    findByUser: jest.fn(),
  };
  const subscriptionsRepository = {
    findByIdOrThrow: jest.fn(),
    findById: jest.fn(),
  };
  const servicePlansRepository = {
    findByIdOrThrow: jest.fn(),
    findById: jest.fn(),
  };
  const pricingService = {
    calculate: jest.fn(),
  };
  const subscriptionChargePeriodService = {
    resolveChargePeriod: jest.fn(),
  };
  const auditLog = {
    log: jest.fn(),
  };

  const basePromotion = {
    id: 'promo-1',
    code: 'SAVE10',
    name: 'Save 10',
    advantageType: PromotionAdvantageType.FIXED_AMOUNT_NET,
    advantageConfig: { amountNet: 10 },
    subscriptionEligibility: 'both',
    applicablePlanIds: null,
  };

  let service: PromotionRedemptionService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PromotionRedemptionService(
      dataSource as never,
      promotionValidationService as never,
      promotionsRepository as never,
      promotionRedemptionsRepository as never,
      subscriptionsRepository as never,
      servicePlansRepository as never,
      pricingService as never,
      subscriptionChargePeriodService as never,
      auditLog as never,
    );
    promotionValidationService.resolvePromotion.mockResolvedValue(basePromotion);
    promotionValidationService.validatePromotion.mockResolvedValue({
      promotion: basePromotion,
      target: { planId: 'plan-1', subscriptionId: 'sub-1' },
    });
    promotionsRepository.findByIdForUpdate.mockResolvedValue(basePromotion);
    promotionRedemptionsRepository.hasActiveRedemptionForSubscription.mockResolvedValue(false);
    promotionRedemptionsRepository.create.mockResolvedValue({
      id: 'red-1',
      codeSnapshot: 'SAVE10',
      subscriptionId: 'sub-1',
      redemptionContext: PromotionRedemptionContext.EXISTING,
      status: PromotionRedemptionStatus.ACTIVE,
      redeemedAt: new Date('2026-01-01T00:00:00Z'),
      benefitStartsAt: new Date('2026-01-01T00:00:00Z'),
      benefitEndsAt: null,
      remainingAmountNet: 10,
      remainingBillingPeriods: null,
      promotion: basePromotion,
    });
    promotionRedemptionsRepository.findByIdOrThrow.mockResolvedValue({
      id: 'red-1',
      codeSnapshot: 'SAVE10',
      subscriptionId: 'sub-1',
      redemptionContext: PromotionRedemptionContext.EXISTING,
      status: PromotionRedemptionStatus.ACTIVE,
      redeemedAt: new Date('2026-01-01T00:00:00Z'),
      benefitStartsAt: new Date('2026-01-01T00:00:00Z'),
      promotion: basePromotion,
    });
    subscriptionsRepository.findById.mockResolvedValue({
      id: 'sub-1',
      planId: 'plan-1',
      number: 'SUB-1',
    });
    servicePlansRepository.findById.mockResolvedValue({ id: 'plan-1', name: 'Basic' });
  });

  it('returns invalid validation response for bad codes', async () => {
    promotionValidationService.validatePromotion.mockRejectedValue(new BadRequestException('bad'));

    const result = await service.validate('user-1', 'BAD', PromotionRedemptionContext.NEW, { planId: 'plan-1' });

    expect(result).toEqual({ valid: false, message: PROMOTION_INVALID_CODE_MESSAGE });
  });

  it('returns validation success with charge period for existing subscriptions', async () => {
    subscriptionsRepository.findByIdOrThrow.mockResolvedValue({
      id: 'sub-1',
      planId: 'plan-1',
    });
    servicePlansRepository.findByIdOrThrow.mockResolvedValue({ id: 'plan-1' });
    pricingService.calculate.mockReturnValue({ totalPrice: 49.99 });
    subscriptionChargePeriodService.resolveChargePeriod.mockResolvedValue({
      periodStart: new Date('2026-01-01T00:00:00Z'),
      periodEnd: new Date('2026-02-01T00:00:00Z'),
      baseAmount: 49.99,
    });

    const result = await service.validate('user-1', 'SAVE10', PromotionRedemptionContext.EXISTING, {
      subscriptionId: 'sub-1',
    });

    expect(result.valid).toBe(true);
    expect(result.chargePeriodStart).toBeDefined();
    expect(result.chargePeriodEnd).toBeDefined();
  });

  it('redeems promotion inside transaction and uses validated benefit start', async () => {
    const validatedStart = new Date().toISOString();

    await service.redeem('user-1', 'SAVE10', 'sub-1', PromotionRedemptionContext.EXISTING, {
      benefitStartsAt: validatedStart,
    });

    expect(dataSource.transaction).toHaveBeenCalled();
    expect(promotionsRepository.findByIdForUpdate).toHaveBeenCalledWith('promo-1', { id: 'tx-manager' });
    expect(promotionRedemptionsRepository.hasActiveRedemptionForSubscription).toHaveBeenCalledWith('promo-1', 'sub-1', {
      id: 'tx-manager',
    });
    expect(promotionRedemptionsRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        benefitStartsAt: new Date(validatedStart),
        status: PromotionRedemptionStatus.ACTIVE,
      }),
      { id: 'tx-manager' },
    );
    expect(auditLog.log).toHaveBeenCalled();
  });

  it('rejects duplicate active redemption for subscription', async () => {
    promotionRedemptionsRepository.hasActiveRedemptionForSubscription.mockResolvedValue(true);

    await expect(service.redeem('user-1', 'SAVE10', 'sub-1', PromotionRedemptionContext.EXISTING)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('lists active and historical redemptions for user', async () => {
    const redemption = {
      id: 'red-1',
      codeSnapshot: 'SAVE10',
      subscriptionId: 'sub-1',
      redemptionContext: PromotionRedemptionContext.EXISTING,
      status: PromotionRedemptionStatus.ACTIVE,
      redeemedAt: new Date('2026-01-01T00:00:00Z'),
      benefitStartsAt: new Date('2026-01-01T00:00:00Z'),
      promotion: basePromotion,
    };
    promotionRedemptionsRepository.findActiveByUser.mockResolvedValue({ items: [redemption], total: 1 });
    promotionRedemptionsRepository.findByUser.mockResolvedValue({ items: [redemption], total: 1 });

    const active = await service.listActiveForUser('user-1', 10, 0);
    const history = await service.listForUser('user-1', 10, 0);

    expect(active.items).toHaveLength(1);
    expect(active.items[0].code).toBe('SAVE10');
    expect(history.items).toHaveLength(1);
  });
});
