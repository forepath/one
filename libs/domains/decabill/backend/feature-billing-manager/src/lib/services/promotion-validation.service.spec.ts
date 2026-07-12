import { BadRequestException } from '@nestjs/common';

import {
  PROMOTION_INVALID_CODE_MESSAGE,
  PromotionRedemptionContext,
  PromotionSubscriptionEligibility,
} from '../constants/promotion.constants';
import { PromotionAdvantageType } from '../constants/promotion.constants';
import { SubscriptionStatus } from '../entities/subscription.entity';
import { PromotionValidationService } from './promotion-validation.service';

describe('PromotionValidationService', () => {
  const promotionsRepository = {
    findByCode: jest.fn(),
  };
  const promotionRedemptionsRepository = {
    countByPromotion: jest.fn(),
    countByPromotionAndUser: jest.fn(),
  };
  const subscriptionsRepository = {
    findByIdOrThrow: jest.fn(),
  };
  const servicePlansRepository = {
    findByIdOrThrow: jest.fn(),
  };
  const auditLog = { log: jest.fn() };

  let service: PromotionValidationService;

  const basePromotion = {
    id: 'promo-1',
    code: 'SAVE10',
    isActive: true,
    redeemableFrom: new Date('2020-01-01'),
    redeemableTo: new Date('2099-01-01'),
    maxTotalRedemptions: 100,
    maxPerUserRedemptions: 1,
    subscriptionEligibility: PromotionSubscriptionEligibility.BOTH,
    applicablePlanIds: null,
    advantageType: PromotionAdvantageType.FIXED_AMOUNT_NET,
    advantageConfig: { amountNet: 10 },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PromotionValidationService(
      promotionsRepository as never,
      promotionRedemptionsRepository as never,
      subscriptionsRepository as never,
      servicePlansRepository as never,
      auditLog as never,
    );
    promotionRedemptionsRepository.countByPromotion.mockResolvedValue(0);
    promotionRedemptionsRepository.countByPromotionAndUser.mockResolvedValue(0);
    promotionsRepository.findByCode.mockResolvedValue(basePromotion);
    servicePlansRepository.findByIdOrThrow.mockResolvedValue({ id: 'plan-1' });
  });

  it('rejects existing-only promotion for new checkout context', async () => {
    promotionsRepository.findByCode.mockResolvedValue({
      ...basePromotion,
      subscriptionEligibility: PromotionSubscriptionEligibility.EXISTING,
    });

    await expect(
      service.validatePromotion({
        userId: 'user-1',
        code: 'SAVE10',
        redemptionContext: PromotionRedemptionContext.NEW,
        planId: 'plan-1',
      }),
    ).rejects.toThrow(new BadRequestException(PROMOTION_INVALID_CODE_MESSAGE));
  });

  it('accepts new checkout validation with planId', async () => {
    const result = await service.validatePromotion({
      userId: 'user-1',
      code: 'SAVE10',
      redemptionContext: PromotionRedemptionContext.NEW,
      planId: 'plan-1',
    });

    expect(result.promotion.id).toBe('promo-1');
    expect(result.target.planId).toBe('plan-1');
  });

  it('rejects when subscription is not active for existing context', async () => {
    subscriptionsRepository.findByIdOrThrow.mockResolvedValue({
      id: 'sub-1',
      userId: 'user-1',
      planId: 'plan-1',
      status: SubscriptionStatus.CANCELED,
    });

    await expect(
      service.validatePromotion({
        userId: 'user-1',
        code: 'SAVE10',
        redemptionContext: PromotionRedemptionContext.EXISTING,
        subscriptionId: 'sub-1',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects inactive and expired promotions', async () => {
    promotionsRepository.findByCode.mockResolvedValue({ ...basePromotion, isActive: false });

    await expect(
      service.validatePromotion({
        userId: 'user-1',
        code: 'SAVE10',
        redemptionContext: PromotionRedemptionContext.NEW,
        planId: 'plan-1',
      }),
    ).rejects.toThrow(BadRequestException);

    promotionsRepository.findByCode.mockResolvedValue({
      ...basePromotion,
      redeemableTo: new Date('2020-01-02'),
    });

    await expect(
      service.validatePromotion({
        userId: 'user-1',
        code: 'SAVE10',
        redemptionContext: PromotionRedemptionContext.NEW,
        planId: 'plan-1',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects ineligible plans and exhausted usage limits', async () => {
    promotionsRepository.findByCode.mockResolvedValue({
      ...basePromotion,
      applicablePlanIds: ['plan-2'],
    });

    await expect(
      service.validatePromotion({
        userId: 'user-1',
        code: 'SAVE10',
        redemptionContext: PromotionRedemptionContext.NEW,
        planId: 'plan-1',
      }),
    ).rejects.toThrow(BadRequestException);

    promotionsRepository.findByCode.mockResolvedValue(basePromotion);
    promotionRedemptionsRepository.countByPromotionAndUser.mockResolvedValue(1);

    await expect(
      service.validatePromotion({
        userId: 'user-1',
        code: 'SAVE10',
        redemptionContext: PromotionRedemptionContext.NEW,
        planId: 'plan-1',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects when total redemption limit is reached', async () => {
    promotionsRepository.findByCode.mockResolvedValue({
      ...basePromotion,
      maxTotalRedemptions: 1,
    });
    promotionRedemptionsRepository.countByPromotion.mockResolvedValue(1);

    await expect(
      service.validatePromotion({
        userId: 'user-1',
        code: 'SAVE10',
        redemptionContext: PromotionRedemptionContext.NEW,
        planId: 'plan-1',
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
